/**
 * Callback query handlers for inline keyboard buttons
 *
 * Handles callbacks that are NOT part of a conversation wizard.
 * Conversation wizards handle their own callbacks via waitForCallbackQuery().
 */
import { InlineKeyboard } from 'grammy';
import type { BotContext } from './types.js';
import { setPendingPool, getCachedPosition, setWaitingForCA, setPendingPoolAddress, getDisplayedPool, setPendingLpPool, getPoolByPrefix } from './types.js';
import {
  getRecipient,
  upsertRecipient,
  getWalletByChatId,
} from '../notifications/index.js';
import { getUserByChat, getUserPositions, type PositionDetails } from '../onboarding/index.js';
import { Connection, PublicKey, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { assessPositionRisk } from '../risk/index.js';
import { discoverAllPositions } from '../utils/position-discovery.js';
import { rangeBar } from '../utils/sparkline.js';

export async function handleCallback(ctx: BotContext) {
  const data = ctx.callbackQuery?.data;
  const chatId = ctx.chat?.id;
  if (!data || !chatId) return;

  // ---- Command shortcuts from main menu ----
  if (data.startsWith('cmd:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const cmd = data.slice(4);
    switch (cmd) {
      case 'balance':
        const { balanceCommand } = await import('./commands/balance.js');
        return balanceCommand(ctx);
      case 'positions':
        const { positionsCommand } = await import('./commands/positions.js');
        return positionsCommand(ctx);
      case 'pools':
        const { poolsCommand } = await import('./commands/pools.js');
        return poolsCommand(ctx);
      case 'withdraw':
        const { withdrawCommand } = await import('./commands/withdraw.js');
        return withdrawCommand(ctx);
      case 'settings':
        const { settingsCommand } = await import('./commands/settings.js');
        return settingsCommand(ctx);
      case 'portfolio':
        const { portfolioCommand } = await import('./commands/portfolio.js');
        return portfolioCommand(ctx);
      case 'rebalance':
        await ctx.conversation.enter('rebalanceWizard');
        return;
      default:
        await ctx.reply(`Unknown command: ${cmd}`);
        return;
    }
  }

  // ---- Pool category selection ----
  if (data.startsWith('pools:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const category = data.split(':')[1];

    if (category === 'ca') {
      // Paste CA flow: ask user to send the pool address as text
      if (chatId) setWaitingForCA(chatId);
      await ctx.reply('Paste the pool contract address (CA):');
      return;
    }

    if (category === 'orca') {
      const { showOrcaPools } = await import('./commands/pools.js');
      await showOrcaPools(ctx);
      return;
    }

    if (category === 'best') {
      // Unified best yields across all DEXes
      const { showBestYieldPools } = await import('./commands/pools.js');
      await showBestYieldPools(ctx);
      return;
    }

    // Load and display pools by category
    const { showPoolCategory } = await import('./commands/pools.js');
    await showPoolCategory(ctx, category as any);
    return;
  }

  // ---- Settings toggles ----
  if (data.startsWith('set:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = data.split(':');
    const setting = parts[1];
    const walletId = parts.slice(2).join(':');

    if (!walletId) {
      await ctx.reply('Wallet not found.');
      return;
    }

    try {
      const recipient = await getRecipient(walletId);
      if (!recipient) {
        await ctx.reply('Settings not found. Use /start first.');
        return;
      }

      let message = '';
      switch (setting) {
        case 'alert': {
          const newVal = !recipient.preferences.alertOnOutOfRange;
          await upsertRecipient({
            walletId,
            preferences: { ...recipient.preferences, alertOnOutOfRange: newVal },
          });
          message = `Out of range alerts: ${newVal ? 'ON' : 'OFF'}`;
          break;
        }
        case 'rebal': {
          const newVal = !recipient.preferences.autoRebalance;
          await upsertRecipient({
            walletId,
            preferences: { ...recipient.preferences, autoRebalance: newVal },
          });
          message = `Auto-rebalance: ${newVal ? 'ON' : 'OFF'}`;
          break;
        }
        case 'daily': {
          const newVal = !recipient.preferences.dailySummary;
          await upsertRecipient({
            walletId,
            preferences: { ...recipient.preferences, dailySummary: newVal },
          });
          message = `Daily summary: ${newVal ? 'ON' : 'OFF'}`;
          break;
        }
        case 'thresh': {
          // Cycle through thresholds: 0 -> 5 -> 10 -> 25 -> 0
          const thresholds = [0, 5, 10, 25];
          const current = recipient.preferences.alertOnValueChange || 0;
          const idx = thresholds.indexOf(current);
          const newVal = thresholds[(idx + 1) % thresholds.length];
          await upsertRecipient({
            walletId,
            preferences: { ...recipient.preferences, alertOnValueChange: newVal },
          });
          message = newVal > 0 
            ? `Alert threshold: ${newVal}% value change`
            : `Alert threshold: Any change`;
          break;
        }
        case 'quiet': {
          // Toggle quiet hours (22:00-08:00 UTC)
          const hasQuiet = !!recipient.preferences.quietHours;
          const newQuiet = hasQuiet ? undefined : { start: 22, end: 8 };
          await upsertRecipient({
            walletId,
            preferences: { ...recipient.preferences, quietHours: newQuiet },
          });
          message = newQuiet 
            ? `Quiet hours: 22:00-08:00 UTC (no alerts)`
            : `Quiet hours: OFF`;
          break;
        }
        default:
          message = 'Unknown setting.';
      }

      await ctx.reply(message);
    } catch (error: any) {
      console.error('[Bot] Settings toggle error:', error);
      await ctx.reply('Failed to update setting. Please try again.');
    }
    return;
  }

  // ---- Pool selection from /pools → enter unified LP wizard ----
  // New format: lp:p:dex:addressPrefix (stable, doesn't rely on index)
  if (data.startsWith('lp:p:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = data.split(':');
    const dexTag = parts[2]; // 'o' = orca, 'm' = meteora
    const prefix = parts[3]; // first 11 chars of address
    
    const displayed = getPoolByPrefix(prefix);
    if (displayed && chatId) {
      // Use unified wizard for all DEXes
      const dex = (dexTag === 'o' || displayed.dex === 'orca') ? 'orca' : 'meteora';
      setPendingLpPool(chatId, {
        address: displayed.address,
        dex,
        name: displayed.name,
        tickSpacing: displayed.tickSpacing,
      });
      await ctx.conversation.enter('unifiedLpWizard');
    } else {
      await ctx.reply('Pool not found. Please refresh the pool list with /pools');
    }
    return;
  }
  
  // Legacy format: lp:pool:N (index-based, kept for backward compat)
  if (data.startsWith('lp:pool:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const poolIdPart = data.split(':')[2];

    if (poolIdPart === 'ca') {
      // CA flow: address was already stored via setPendingPoolAddress
      // Unified wizard handles consumePendingPoolAddress
      await ctx.conversation.enter('unifiedLpWizard');
      return;
    }

    const poolIdx = parseInt(poolIdPart);
    if (!isNaN(poolIdx) && chatId) {
      // Look up actual pool address from the displayed pools cache
      const displayed = getDisplayedPool(chatId, poolIdx);
      if (displayed) {
        // Use unified wizard for all DEXes
        const dex = displayed.dex === 'orca' ? 'orca' : 'meteora';
        setPendingLpPool(chatId, {
          address: displayed.address,
          dex,
          name: displayed.name,
          tickSpacing: displayed.tickSpacing,
        });
        await ctx.conversation.enter('unifiedLpWizard');
      } else {
        // Fallback: store index for backward compat with unified wizard's own fetch
        setPendingPool(chatId, poolIdx);
        await ctx.conversation.enter('unifiedLpWizard');
      }
    }
    return;
  }

  // ---- Dismiss ----
  if (data === 'dismiss') {
    await ctx.answerCallbackQuery('Dismissed').catch(() => {});
    return;
  }

  // ---- Cancel ----
  if (data === 'cancel') {
    await ctx.answerCallbackQuery('Cancelled').catch(() => {});
    await ctx.reply('Cancelled.');
    return;
  }

  // ---- Convert all tokens to SOL ----
  if (data === 'swap:all:sol') {
    await ctx.answerCallbackQuery().catch(() => {});

    await ctx.reply('Converting all tokens to SOL...\n\nThis may take a moment.');

    (async () => {
      try {
        const { getUserByChat } = await import('../onboarding/index.js');
        const { loadWalletById, getConnection } = await import('../services/wallet-service.js');

        const user = await getUserByChat(chatId);
        if (!user) {
          await ctx.reply('No wallet found. Use /start first.');
          return;
        }

        const connection = getConnection();
        const userPubkey = new PublicKey(user.walletAddress);
        const solMint = 'So11111111111111111111111111111111111111112';

        // Fetch all SPL token accounts with raw amounts
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(userPubkey, {
          programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        });

        const nonSolTokens = tokenAccounts.value
          .map(acc => {
            const info = acc.account.data.parsed.info;
            return {
              mint: info.mint as string,
              amount: parseFloat(info.tokenAmount.uiAmountString || '0'),
              rawAmount: parseInt(info.tokenAmount.amount || '0'),
              symbol: info.mint.slice(0, 6) + '...',
            };
          })
          .filter(t => t.rawAmount > 0 && t.mint !== solMint);

        if (nonSolTokens.length === 0) {
          await ctx.reply('No tokens to convert. All funds are already in SOL.');
          return;
        }

        const { client } = await loadWalletById(user.walletId);
        const { jupiterClient } = await import('../swap/jupiter.js');

        let converted = 0;
        const results: string[] = [];

        for (const token of nonSolTokens) {
          try {
            console.log(`[Bot] Swap: converting ${token.amount} (${token.mint}) to SOL`);
            const { quote, swap } = await jupiterClient.getSwapTransaction(
              token.mint,
              solMint,
              token.rawAmount,
              user.walletAddress,
              150, // 1.5% slippage
            );

            const txHash = await client.signAndSendTransaction(swap.swapTransaction);
            console.log(`[Bot] Swap → SOL tx: ${txHash}`);
            results.push(`\`${token.mint.slice(0, 8)}...\`: ${token.amount.toFixed(4)} → SOL`);
            converted++;
          } catch (swapErr: any) {
            console.error(`[Bot] Swap ${token.mint.slice(0, 8)} failed:`, swapErr?.message);
            results.push(`\`${token.mint.slice(0, 8)}...\`: failed`);
          }
        }

        const text = [
          `*Token Conversion Complete*`,
          ``,
          `Converted ${converted}/${nonSolTokens.length} tokens:`,
          ...results,
          ``,
          `Use /balance to check.`,
        ].join('\n');

        await ctx.reply(text, { parse_mode: 'Markdown' });
      } catch (error: any) {
        console.error('[Bot] Swap all to SOL error:', error);
        await ctx.reply(`Failed to convert tokens: ${error?.message?.slice(0, 100) || 'unknown error'}`);
      }
    })();
    return;
  }

  // ---- Snooze alert ----
  if (data.startsWith('snooze:')) {
    await ctx.answerCallbackQuery('Snoozed for 1 hour').catch(() => {});
    await ctx.reply('Snoozed for 1 hour. I\'ll check again later.');
    return;
  }

  // ---- Position detail ----
  if (data.startsWith('pd:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const posIdx = parseInt(data.split(':')[1]);

    try {
      const user = await getUserByChat(chatId);
      if (!user) {
        await ctx.reply('No wallet found. Use /start.');
        return;
      }

      const positions = await getUserPositions(user.walletAddress);
      const pos = positions[posIdx];

      if (!pos) {
        await ctx.reply('Position not found. Use /positions to refresh.');
        return;
      }

      const priceFmt = (n: number) => (n < 1 ? n.toFixed(4) : n.toFixed(2));

      // Fetch raw position data for risk assessment (includes bin IDs)
      let riskLines: string[] = [];
      try {
        const { getConnection } = await import('../services/wallet-service.js');
        const connection = getConnection();
        const rawPositions = await discoverAllPositions(connection, user.walletAddress);
        const rawPos = rawPositions.find(p => p.address === pos.address);

        if (rawPos) {
          const risk = await assessPositionRisk(
            rawPos.address,
            rawPos.pool.address,
            rawPos.pool.name || pos.pool,
            rawPos.activeBinId,
            rawPos.binRange.lower,
            rawPos.binRange.upper,
            pos.inRange ? undefined : new Date().toISOString(),
            rawPos.pool.tokenX?.symbol,
            rawPos.pool.tokenY?.symbol,
          );

          const urgencyIndicator =
            risk.urgency === 'critical' ? '!!!' :
            risk.urgency === 'high' ? '!!' :
            risk.urgency === 'medium' ? '!' : '';

          riskLines = [
            ``,
            `Risk Assessment: ${urgencyIndicator}`,
            `  Health: ${risk.healthScore}/100`,
            `  Action: ${risk.action.toUpperCase()} - ${risk.actionReason}`,
          ];

          if (risk.ilCurrent > 0) {
            riskLines.push(`  Est. IL: ${risk.ilCurrent}%`);
          }
        }
      } catch (riskErr: any) {
        console.error('[Bot] Risk assessment failed (non-blocking):', riskErr?.message);
      }

      // Generate visual range bar
      const visualRange = rangeBar(
        pos.priceRange.lower,
        pos.priceRange.current,
        pos.priceRange.upper
      );

      const status = pos.inRange ? '🟢 IN RANGE' : '🔴 OUT OF RANGE';
      
      // Calculate percentage through range
      const range = pos.priceRange.upper - pos.priceRange.lower;
      const positionInRange = (pos.priceRange.current - pos.priceRange.lower) / range;
      const rangePercent = Math.round(Math.max(0, Math.min(100, positionInRange * 100)));
      
      // Suggest action based on position
      let actionHint = '';
      if (!pos.inRange) {
        actionHint = '\n\n⚠️ *Out of range* — not earning fees. Consider rebalancing.';
      } else if (rangePercent < 15 || rangePercent > 85) {
        actionHint = '\n\n⚡ *Near edge* — may go out of range soon. Watch closely.';
      }

      const text = [
        `*${pos.pool}* ${status}`,
        ``,
        `📊 *Price Range*`,
        visualRange,
        ``,
        `💰 *Position Value*`,
        `  ${pos.amounts.tokenX.formatted}`,
        `  ${pos.amounts.tokenY.formatted}`,
        ``,
        `✨ *Fees Earned*`,
        `  ${pos.fees.tokenX} + ${pos.fees.tokenY}`,
        ...riskLines,
        actionHint,
        ``,
        `\`${pos.address.slice(0, 16)}...\``,
      ].filter(Boolean).join('\n');

      const { positionActionsKeyboard } = await import('./keyboards.js');
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: positionActionsKeyboard(posIdx),
      });
    } catch (error: any) {
      console.error('[Bot] Position detail error:', error);
      await ctx.reply('Failed to load position details.');
    }
    return;
  }

  // ---- Solscan link ----
  if (data.startsWith('scan:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const posIdx = parseInt(data.split(':')[1]);

    try {
      const user = await getUserByChat(chatId);
      if (!user) {
        await ctx.reply('No wallet found.');
        return;
      }

      const positions = await getUserPositions(user.walletAddress);
      const pos = positions[posIdx];

      if (pos) {
        await ctx.reply(`View on Solscan:\nhttps://solscan.io/account/${pos.address}`);
      } else {
        await ctx.reply('Position not found.');
      }
    } catch {
      await ctx.reply('Failed to get position info.');
    }
    return;
  }

  // ---- Withdraw confirm (wdc:N) — execute position close directly ----
  // Uses signAndSendTransaction (RPC) instead of Jito bundles for reliability.
  // Simpler flow: withdraw liquidity + claim fees + close position.
  if (data.startsWith('wdc:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const posIdx = parseInt(data.split(':')[1]);
    const cached = getCachedPosition(chatId, posIdx);

    if (!cached) {
      await ctx.reply('Position data expired. Use /positions to refresh, then tap Withdraw.');
      return;
    }

    await ctx.reply(
      `Closing *${cached.pool}* position...\n\nThis may take 30-60 seconds.`,
      { parse_mode: 'Markdown' },
    );

    // Execute in background to avoid webhook timeout
    (async () => {
      try {
        const { loadWalletById, getConnection } = await import('../services/wallet-service.js');
        const { invalidatePositionCache } = await import('../services/lp-service.js');

        const { client } = await loadWalletById(cached.walletId);

        // ---- Orca Whirlpool withdraw path ----
        if (cached.dex === 'orca' && cached.positionMintAddress) {
          const { executeOrcaWithdraw } = await import('../services/orca-service.js');
          const result = await executeOrcaWithdraw({
            walletId: cached.walletId,
            walletAddress: cached.walletAddress,
            poolAddress: cached.poolAddress,
            positionMintAddress: cached.positionMintAddress,
            slippageBps: 300,
            signTransaction: async (tx) => client.signTransaction(tx),
            signAndSendTransaction: async (tx) => client.signAndSendTransaction(tx),
          });

          const txHashes = result.txHashes || [];
          if (txHashes.length > 0) {
            const lastHash = txHashes[txHashes.length - 1];
            await ctx.reply(
              `*Orca Position Closed!*\n\nPool: *${cached.pool}*\nTransactions: ${txHashes.length}\nTx: \`${lastHash.slice(0, 16)}...\`\n\nTokens returned to your wallet.\nUse /balance to check.`,
              { parse_mode: 'Markdown' },
            );
          } else {
            await ctx.reply('No transactions were sent. The position may already be closed.');
          }
          return;
        }

        // ---- Meteora DLMM withdraw path ----
        const connection = getConnection();
        const userPubkey = new PublicKey(cached.walletAddress);

        // 1. Get pool and position on-chain
        console.log(`[Bot] Withdraw: loading pool ${cached.poolAddress.slice(0, 8)}...`);
        const pool = await DLMM.create(connection, new PublicKey(cached.poolAddress));
        const userPositions = await pool.getPositionsByUserAndLbPair(userPubkey);

        const position = userPositions.userPositions.find(
          (p: any) => p.publicKey.toBase58() === cached.address
        );

        if (!position) {
          await ctx.reply('Position not found on-chain. It may already be closed.\n\nUse /positions to refresh.');
          return;
        }

        // 2. Build remove liquidity transactions (withdraw all + claim fees + close)
        const positionData = position.positionData;
        const withdrawTx = await pool.removeLiquidity({
          position: position.publicKey,
          user: userPubkey,
          fromBinId: positionData.lowerBinId,
          toBinId: positionData.upperBinId,
          bps: new BN(10000), // 100% of liquidity
          shouldClaimAndClose: true,
        });

        const withdrawTxArray = Array.isArray(withdrawTx) ? withdrawTx : [withdrawTx];
        const { blockhash } = await connection.getLatestBlockhash('finalized');

        console.log(`[Bot] Withdraw: ${withdrawTxArray.length} tx(s) for position ${cached.address.slice(0, 8)}`);

        // 3. Sign and send each transaction individually via Privy RPC
        const txHashes: string[] = [];
        for (let i = 0; i < withdrawTxArray.length; i++) {
          const tx = withdrawTxArray[i];
          let serialized: string;

          if ('recentBlockhash' in tx) {
            // Legacy Transaction
            tx.recentBlockhash = blockhash;
            tx.feePayer = userPubkey;
            serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
          } else if ('instructions' in tx) {
            // Instructions — build VersionedTransaction
            const msg = new TransactionMessage({
              payerKey: userPubkey,
              recentBlockhash: blockhash,
              instructions: tx.instructions,
            }).compileToV0Message();
            const vtx = new VersionedTransaction(msg);
            serialized = Buffer.from(vtx.serialize()).toString('base64');
          } else {
            console.warn(`[Bot] Withdraw: unexpected tx format at index ${i}, skipping`);
            continue;
          }

          console.log(`[Bot] Withdraw: signing+sending tx ${i + 1}/${withdrawTxArray.length}...`);
          const txHash = await client.signAndSendTransaction(serialized);
          console.log(`[Bot] Withdraw tx ${i + 1}/${withdrawTxArray.length} confirmed: ${txHash}`);
          txHashes.push(txHash);

          // Wait between transactions for state to propagate on-chain
          if (i < withdrawTxArray.length - 1) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        await invalidatePositionCache(cached.walletId);

        if (txHashes.length > 0) {
          const lastHash = txHashes[txHashes.length - 1];
          await ctx.reply(
            `*Position Closed!*\n\nPool: *${cached.pool}*\nTransactions: ${txHashes.length}\nTx: \`${lastHash.slice(0, 16)}...\`\n\nTokens returned to your wallet.\nUse /balance to check.`,
            { parse_mode: 'Markdown' },
          );
        } else {
          await ctx.reply('No transactions were sent. The position may already be closed.');
        }
      } catch (error: any) {
        console.error('[Bot] Direct withdraw error:', error);
        const { friendlyErrorMessage } = await import('../utils/resilience.js');
        await ctx.reply(
          `*Withdrawal Failed*\n\n${friendlyErrorMessage(error)}\n\nYour tokens are safe. Try again from /positions.`,
          { parse_mode: 'Markdown' },
        );
      }
    })();
    return;
  }

  // ---- Withdraw from positions view (wd:N) — show confirmation ----
  if (data.startsWith('wd:') && !data.startsWith('wd:sel:') && !data.startsWith('wd:cf:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const posIdx = parseInt(data.split(':')[1]);
    const cached = getCachedPosition(chatId, posIdx);

    if (!cached) {
      await ctx.reply('Position data expired. Use /positions to refresh.');
      return;
    }

    const kb = new InlineKeyboard()
      .text('Confirm Close', `wdc:${posIdx}`)
      .text('Cancel', 'cancel');

    await ctx.reply(
      `*Close Position?*\n\nPool: *${cached.pool}*\nPosition: \`${cached.address.slice(0, 8)}...\`\n\nThis will withdraw all liquidity, claim fees, and convert to SOL.`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
    return;
  }

  // ---- Rebalance shortcut ----
  if (data.startsWith('rb:') && !data.startsWith('rb:sel:') && !data.startsWith('rb:str:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    // Enter rebalance wizard
    await ctx.conversation.enter('rebalanceWizard');
    return;
  }

  // ---- Fee claim ----
  if (data.startsWith('fee:') && !data.startsWith('fee:sel:') && !data.startsWith('fee:cf:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const posIdx = parseInt(data.split(':')[1]);
    const cached = getCachedPosition(chatId, posIdx);

    if (!cached) {
      await ctx.reply('Position data expired. Use /positions to refresh.');
      return;
    }

    await ctx.reply(
      `Claiming fees from *${cached.pool}*...\n\nThis may take 30 seconds.`,
      { parse_mode: 'Markdown' },
    );

    // Execute in background to avoid webhook timeout
    (async () => {
      try {
        const { loadWalletById, getConnection } = await import('../services/wallet-service.js');
        const { client } = await loadWalletById(cached.walletId);

        // ---- Orca Whirlpool fee claim path ----
        if (cached.dex === 'orca' && cached.positionMintAddress) {
          const { executeOrcaFeeClaim } = await import('../services/orca-service.js');
          const result = await executeOrcaFeeClaim({
            walletId: cached.walletId,
            walletAddress: cached.walletAddress,
            positionMintAddress: cached.positionMintAddress,
            signAndSendTransaction: async (tx) => client.signAndSendTransaction(tx),
          });

          if (result.txHashes.length > 0) {
            await ctx.reply(
              `*Orca Fees Claimed!*\n\nPool: *${cached.pool}*\nTx: \`${result.txHashes[result.txHashes.length - 1].slice(0, 16)}...\`\n\nUse /balance to check.`,
              { parse_mode: 'Markdown' },
            );
          } else {
            await ctx.reply('No fees to claim yet.');
          }
          return;
        }

        // ---- Meteora DLMM fee claim path ----
        const connection = getConnection();
        const userPubkey = new PublicKey(cached.walletAddress);

        // Load pool and find position
        const pool = await DLMM.create(connection, new PublicKey(cached.poolAddress));
        const userPositions = await pool.getPositionsByUserAndLbPair(userPubkey);
        const position = userPositions.userPositions.find(
          (p: any) => p.publicKey.toBase58() === cached.address
        );

        if (!position) {
          await ctx.reply('Position not found on-chain. It may have been closed.\n\nUse /positions to refresh.');
          return;
        }

        // Check if there are fees to claim
        const posData = position.positionData;
        const feeX = posData.feeX?.toString() || '0';
        const feeY = posData.feeY?.toString() || '0';

        if (feeX === '0' && feeY === '0') {
          await ctx.reply('No fees to claim yet. Fees accumulate when trades go through your price range.');
          return;
        }

        // Build claim transaction
        const claimTx = await pool.claimSwapFee({
          owner: userPubkey,
          position: position,
        });

        const txArray = Array.isArray(claimTx) ? claimTx : [claimTx];
        const { blockhash } = await connection.getLatestBlockhash('finalized');

        const txHashes: string[] = [];
        for (let i = 0; i < txArray.length; i++) {
          const tx = txArray[i];
          let serialized: string;

          if ('recentBlockhash' in tx) {
            tx.recentBlockhash = blockhash;
            tx.feePayer = userPubkey;
            serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
          } else if ('instructions' in tx) {
            const msg = new TransactionMessage({
              payerKey: userPubkey,
              recentBlockhash: blockhash,
              instructions: tx.instructions,
            }).compileToV0Message();
            const vtx = new VersionedTransaction(msg);
            serialized = Buffer.from(vtx.serialize()).toString('base64');
          } else {
            continue;
          }

          const txHash = await client.signAndSendTransaction(serialized);
          txHashes.push(txHash);

          if (i < txArray.length - 1) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        if (txHashes.length > 0) {
          await ctx.reply(
            `*Fees Claimed!*\n\nPool: *${cached.pool}*\nFees: ${feeX} tokenX + ${feeY} tokenY\nTx: \`${txHashes[txHashes.length - 1].slice(0, 16)}...\`\n\nUse /balance to check.`,
            { parse_mode: 'Markdown' },
          );
        } else {
          await ctx.reply('No transactions were sent. Fees may have already been claimed.');
        }
      } catch (error: any) {
        console.error('[Bot] Fee claim error:', error);
        const { friendlyErrorMessage } = await import('../utils/resilience.js');
        await ctx.reply(
          `*Fee Claim Failed*\n\n${friendlyErrorMessage(error)}\n\nTry again from /positions.`,
          { parse_mode: 'Markdown' },
        );
      }
    })();
    return;
  }

  // ---- Tips ----
  if (data.startsWith('tips:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const { tipsCommand } = await import('./commands/tips.js');
    
    if (data === 'tips:next') {
      await tipsCommand(ctx);
    } else if (data === 'tips:all') {
      const tips = [
        '💡 *Concentrated vs Wide*: Concentrated = more fees, more work. Wide = passive.',
        '📊 *IL Risk*: Bigger price moves = more IL. Fees often offset it.',
        '⚡ *Rebalance*: When out of range, use /rebalance to fix.',
        '🎯 *Pool Selection*: Consider TVL, volume, and volatility, not just APR.',
        '🔒 *Security*: Claim fees regularly, check positions, use alerts.',
      ];
      await ctx.reply(
        `*All LP Tips*\n\n${tips.join('\n\n')}`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  // ---- Swap ----
  if (data.startsWith('swap:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    
    // Quick swap buttons: swap:0.1:SOL:USDC
    const parts = data.split(':');
    if (parts.length === 4 && parts[1] !== 'exec') {
      const amount = parts[1];
      const from = parts[2];
      const to = parts[3];
      // Simulate the command
      if (ctx.message) {
        ctx.message.text = `/swap ${amount} ${from} to ${to}`;
      }
      const { swapCommand } = await import('./commands/swap.js');
      // Create a fake message context
      await ctx.reply(`Processing /swap ${amount} ${from} to ${to}...`);
      return;
    }
    
    // Swap execution: swap:exec:0.1:SOL:USDC
    if (parts[1] === 'exec' && parts.length === 5) {
      const amount = parseFloat(parts[2]);
      const fromToken = parts[3];
      const toToken = parts[4];
      
      await ctx.reply(`🔄 Executing swap: ${amount} ${fromToken} → ${toToken}...\n\nThis may take 30 seconds.`);
      
      // Execute swap in background
      (async () => {
        try {
          const { getUserByChat } = await import('../onboarding/index.js');
          const { loadWalletById } = await import('../services/wallet-service.js');
          
          const user = await getUserByChat(ctx.chat?.id || 0);
          if (!user) {
            await ctx.reply('No wallet found.');
            return;
          }
          
          const { client } = await loadWalletById(user.walletId);
          
          // Token mints
          const TOKEN_MINTS: Record<string, string> = {
            'SOL': 'So11111111111111111111111111111111111111112',
            'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          };
          
          const fromMint = TOKEN_MINTS[fromToken] || fromToken;
          const toMint = TOKEN_MINTS[toToken] || toToken;
          const decimals = fromToken === 'SOL' ? 9 : 6;
          
          // Get swap transaction from Jupiter
          const quoteResp = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${Math.floor(amount * 10 ** decimals)}&slippageBps=100`
          );
          const quote = await quoteResp.json() as any;
          
          const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteResponse: quote,
              userPublicKey: user.walletAddress,
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
            }),
          });
          const swapData = await swapResp.json() as any;
          
          if (!swapData.swapTransaction) {
            throw new Error('Failed to build swap transaction');
          }
          
          // Sign and send
          const txHash = await client.signAndSendTransaction(swapData.swapTransaction);
          
          const outAmount = parseInt(quote.outAmount) / (toToken === 'SOL' ? 1e9 : 1e6);
          await ctx.reply(
            `*Swap Complete!* ✅\n\n` +
            `${amount} ${fromToken} → ${outAmount.toFixed(6)} ${toToken}\n\n` +
            `Tx: \`${txHash.slice(0, 16)}...\`\n\n` +
            `Use /balance to check.`,
            { parse_mode: 'Markdown' }
          );
        } catch (error: any) {
          console.error('[Swap] Execution error:', error);
          await ctx.reply(`*Swap Failed*\n\n${error.message}`, { parse_mode: 'Markdown' });
        }
      })();
      return;
    }
  }

  // ---- Conversation expired handlers ----
  if (data === 'cf:rb') {
    await ctx.answerCallbackQuery('Session expired').catch(() => {});
    await ctx.reply(
      '⏳ *Rebalance session expired*\n\n' +
      'The rebalance wizard timed out. Please start again:\n' +
      '• Use /rebalance to begin a new rebalance flow\n' +
      '• Or tap a position in /positions and select Rebalance',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (data.startsWith('cf:')) {
    await ctx.answerCallbackQuery('Session expired').catch(() => {});
    await ctx.reply(
      '⏳ *Session expired*\n\nThe confirmation window has closed. Please start the operation again.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ---- Fallback ----
  await ctx.answerCallbackQuery('Processing...').catch(() => {});
  console.log(`[Bot] Unhandled callback: ${data}`);
}
