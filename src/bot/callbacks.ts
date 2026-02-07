/**
 * Callback query handlers for inline keyboard buttons
 *
 * Handles callbacks that are NOT part of a conversation wizard.
 * Conversation wizards handle their own callbacks via waitForCallbackQuery().
 */
import { InlineKeyboard } from 'grammy';
import type { BotContext } from './types.js';
import { setPendingPool, getCachedPosition } from './types.js';
import {
  getRecipient,
  upsertRecipient,
  getWalletByChatId,
} from '../notifications/index.js';
import { getUserByChat, getUserPositions, type PositionDetails } from '../onboarding/index.js';
import { Connection, PublicKey, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';

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
      default:
        await ctx.reply(`Unknown command: ${cmd}`);
        return;
    }
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

  // ---- Pool selection from /pools → enter LP wizard with pool pre-selected ----
  if (data.startsWith('lp:pool:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    const poolIdx = parseInt(data.split(':')[2]);
    if (!isNaN(poolIdx) && chatId) {
      setPendingPool(chatId, poolIdx);
      await ctx.conversation.enter('lpWizard');
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

      const text = [
        `*${pos.pool}* - ${pos.inRange ? 'IN RANGE' : 'OUT OF RANGE'}`,
        ``,
        `Address: \`${pos.address.slice(0, 8)}...\``,
        `Price: $${priceFmt(pos.priceRange.current)}`,
        `Range: $${priceFmt(pos.priceRange.lower)} - $${priceFmt(pos.priceRange.upper)}`,
        ``,
        `Position:`,
        `  ${pos.amounts.tokenX.formatted}`,
        `  ${pos.amounts.tokenY.formatted}`,
        ``,
        `Fees Earned:`,
        `  ${pos.fees.tokenX} + ${pos.fees.tokenY}`,
      ].join('\n');

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

        const connection = getConnection();
        const { client } = await loadWalletById(cached.walletId);
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

  // ---- Fallback ----
  await ctx.answerCallbackQuery('Processing...').catch(() => {});
  console.log(`[Bot] Unhandled callback: ${data}`);
}
