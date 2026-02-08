/**
 * Unified LP Wizard - DEX-agnostic LP position creation
 *
 * Flow: Pool pre-selected → Enter amount → Pick strategy → Confirm → Execute
 *
 * Supports both Meteora DLMM and Orca Whirlpools transparently.
 * DEX routing happens at execution time, not wizard entry.
 */
import type { Conversation } from '@grammyjs/conversations';
import type { BotContext } from '../types.js';
import {
  amountKeyboard,
  strategyKeyboard,
  distributionKeyboard,
  confirmKeyboard,
} from '../keyboards.js';
import { getUserByChat } from '../../onboarding/index.js';
import { executeLp, type LpExecuteParams } from '../../services/lp-service.js';
import { executeOrcaLp, type OrcaLpExecuteParams } from '../../services/orca-service.js';
import { loadWalletById, getWalletBalance } from '../../services/wallet-service.js';
import { parseNaturalAmount } from '../../utils/natural-amounts.js';
import { validateSolAmount, validateSolanaAddress, friendlyErrorMessage } from '../../utils/resilience.js';
import { operationLock } from '../../utils/operation-lock.js';
import {
  consumePendingLpPool,
  consumePendingPool,
  consumePendingPoolAddress,
  type PendingLpPool,
} from '../types.js';

// Fee reserve: covers tx fees (~0.01/tx × 3-5), rent for ATAs (~0.003 × 3), position rent (~0.01)
// Atomic LP needs more buffer due to multiple transactions + potential ATA creation
const FEE_RESERVE = 0.15;

interface PoolInfo {
  address: string;
  name: string;
  dex: 'meteora' | 'orca';
  binStep?: number;      // Meteora
  tickSpacing?: number;  // Orca
  apr?: number;          // For yield estimate
  tvl?: number;
}

/**
 * Fetch Meteora pool info by address
 */
async function fetchMeteoraPoolInfo(address: string): Promise<PoolInfo | null> {
  try {
    const resp = await fetch(`https://dlmm-api.meteora.ag/pair/${address}`);
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    return {
      address,
      name: data.name || address.slice(0, 8),
      dex: 'meteora',
      binStep: parseInt(data.bin_step || '10'),
      apr: parseFloat(data.apr || '0') * 100,
      tvl: parseFloat(data.liquidity || '0'),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch top Meteora pools for fallback pool selection
 */
async function fetchTopMeteoraPools(): Promise<PoolInfo[]> {
  try {
    const resp = await fetch('https://dlmm-api.meteora.ag/pair/all');
    if (!resp.ok) return [];

    const all = (await resp.json()) as any[];
    return all
      .filter((p) => p.liquidity && parseFloat(p.liquidity) > 100_000 && !p.is_blacklisted)
      .sort((a: any, b: any) => (b.apr || 0) - (a.apr || 0))
      .slice(0, 6)
      .map((p: any) => ({
        address: p.address,
        name: p.name || 'Unknown',
        dex: 'meteora' as const,
        binStep: parseInt(p.bin_step || '10'),
        apr: parseFloat(p.apr || '0') * 100,
        tvl: parseFloat(p.liquidity || '0'),
      }));
  } catch {
    return [];
  }
}

/**
 * Estimate daily yield based on APR and amount
 */
function estimateDailyYield(amountSol: number, apr: number): string {
  // Assume SOL price ~$100 for display purposes
  const solPrice = 100;
  const depositValue = amountSol * solPrice;
  const dailyYield = (depositValue * (apr / 100)) / 365;
  
  if (dailyYield < 0.01) {
    return `~$${(dailyYield * 100).toFixed(1)}¢/day`;
  } else if (dailyYield < 1) {
    return `~$${dailyYield.toFixed(2)}/day`;
  } else {
    return `~$${dailyYield.toFixed(1)}/day`;
  }
}

export async function unifiedLpWizard(
  conversation: Conversation<BotContext, BotContext>,
  ctx: BotContext,
) {
  // ---- Step 0: Verify user has a wallet ----
  const user = await conversation.external(async () => {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;
    return getUserByChat(chatId);
  });

  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  // ---- Step 1: Pool Selection ----
  // Try multiple sources for pre-selected pool (priority order):
  // 1. consumePendingLpPool() - new DEX-aware format
  // 2. consumePendingPoolAddress() - legacy Meteora CA paste
  // 3. consumePendingPool() - legacy Meteora index-based
  // 4. Fallback to pool browser

  const pendingLpPool = await conversation.external(() => {
    const chatId = ctx.chat?.id;
    if (!chatId) return undefined;
    return consumePendingLpPool(chatId);
  });

  const pendingPoolAddress = await conversation.external(() => {
    const chatId = ctx.chat?.id;
    if (!chatId) return undefined;
    return consumePendingPoolAddress(chatId);
  });

  const pendingPoolIndex = await conversation.external(() => {
    const chatId = ctx.chat?.id;
    if (!chatId) return undefined;
    return consumePendingPool(chatId);
  });

  let selectedPool: PoolInfo;

  if (pendingLpPool) {
    // New DEX-aware pool (from /pools Orca or Meteora selection)
    selectedPool = {
      address: pendingLpPool.address,
      name: pendingLpPool.name || pendingLpPool.address.slice(0, 8),
      dex: pendingLpPool.dex,
      tickSpacing: pendingLpPool.tickSpacing,
    };
    
    // Fetch additional info for APR if needed
    if (pendingLpPool.dex === 'meteora') {
      const fullInfo = await conversation.external(() => fetchMeteoraPoolInfo(pendingLpPool.address));
      if (fullInfo) {
        selectedPool = { ...selectedPool, ...fullInfo };
      }
    }
  } else if (pendingPoolAddress) {
    // Legacy: Pool address was pasted (Meteora CA flow)
    const poolInfo = await conversation.external(() => fetchMeteoraPoolInfo(pendingPoolAddress));
    if (!poolInfo) {
      await ctx.reply('Pool not found for that address. Use /pools to browse.');
      return;
    }
    selectedPool = poolInfo;
  } else if (pendingPoolIndex !== undefined) {
    // Legacy: Pool selected by index from top pools list
    const pools = await conversation.external(fetchTopMeteoraPools);
    const p = pools[pendingPoolIndex];
    if (!p) {
      await ctx.reply('Pool selection expired. Use /pools to browse.');
      return;
    }
    selectedPool = p;
  } else {
    // No pool pre-selected — show pool browser
    const pools = await conversation.external(fetchTopMeteoraPools);
    if (pools.length === 0) {
      await ctx.reply('Could not fetch pools. Please try again later.');
      return;
    }

    const { InlineKeyboard } = await import('grammy');
    const poolKb = new InlineKeyboard();
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      poolKb.text(`${p.name} (${p.apr?.toFixed(1) || '?'}% APR)`, `lp:pool:${i}`).row();
    }
    poolKb.text('Enter pool address', 'lp:pool:custom').row();
    poolKb.text('Cancel', 'cancel');

    await ctx.reply('*Add Liquidity - Select Pool*\n\nChoose a pool:', {
      parse_mode: 'Markdown',
      reply_markup: poolKb,
    });

    const poolCtx = await conversation.waitForCallbackQuery(/^(lp:pool:\d+|lp:pool:custom|cancel)$/, {
      otherwise: async (ctx) => {
        await ctx.reply('Please tap a pool button above, or tap Cancel.');
      },
    });
    await poolCtx.answerCallbackQuery();

    const poolData = poolCtx.callbackQuery.data;
    if (poolData === 'cancel') {
      await poolCtx.reply('LP cancelled.');
      return;
    }

    if (poolData === 'lp:pool:custom') {
      await poolCtx.reply('Enter the pool address:');
      const addrCtx = await conversation.waitFor('message:text', {
        otherwise: async (ctx) => {
          await ctx.reply('Please send the pool address as text.');
        },
      });
      const addr = addrCtx.message.text.trim();
      if (!validateSolanaAddress(addr)) {
        await ctx.reply('Invalid Solana address format. LP cancelled.');
        return;
      }
      
      const poolInfo = await conversation.external(() => fetchMeteoraPoolInfo(addr));
      if (!poolInfo) {
        await ctx.reply('Pool not found. Please check the address and try again.');
        return;
      }
      selectedPool = poolInfo;
    } else {
      const poolIdx = parseInt(poolData.split(':')[2]);
      selectedPool = pools[poolIdx];
      if (!selectedPool) {
        await ctx.reply('Invalid pool selection.');
        return;
      }
    }
  }

  // Show pool header (DEX shown as small detail)
  const dexLabel = selectedPool.dex === 'orca' ? '🌊' : '☄️';
  await ctx.reply(
    `*Add Liquidity*\n\n${dexLabel} *${selectedPool.name}*`,
    { parse_mode: 'Markdown' },
  );

  // ---- Step 2: Amount Selection ----
  await ctx.reply(
    `How much SOL would you like to deposit?`,
    { reply_markup: amountKeyboard() },
  );

  const amtCtx = await conversation.waitForCallbackQuery(/^(lp:amt:.+|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap an amount button above.');
    },
  });
  await amtCtx.answerCallbackQuery();

  const amtData = amtCtx.callbackQuery.data;
  if (amtData === 'cancel') {
    await amtCtx.reply('LP cancelled.');
    return;
  }

  // Fetch balance for max and validation
  const balanceCheck = await conversation.external(async () => {
    try {
      const bal = await getWalletBalance(user.walletAddress);
      console.log(`[Unified LP] Balance: ${bal.sol} SOL`);
      return bal.sol;
    } catch (err) {
      console.error(`[Unified LP] Balance check failed:`, err);
      return null;
    }
  });

  let amount: number;
  if (amtData === 'lp:amt:max') {
    if (balanceCheck === null || balanceCheck <= FEE_RESERVE) {
      await ctx.reply(`Could not determine balance or balance too low. LP cancelled.`);
      return;
    }
    amount = Math.floor((balanceCheck - FEE_RESERVE) * 100) / 100;
    if (amount <= 0) {
      await ctx.reply(`Balance too low for LP (need >${FEE_RESERVE} SOL for fees). LP cancelled.`);
      return;
    }
    await ctx.reply(`Using max: *${amount} SOL* (keeping ${FEE_RESERVE} SOL for fees)`, { parse_mode: 'Markdown' });
  } else if (amtData === 'lp:amt:custom') {
    await ctx.reply(
      'Enter amount:\n• Number: `2.5`\n• Percentage: `50%` or `half`\n• Max: `max` or `all but 0.1`',
      { parse_mode: 'Markdown' },
    );
    const customCtx = await conversation.waitFor('message:text', {
      otherwise: async (ctx) => {
        await ctx.reply('Please send an amount (e.g., "2.5", "50%", "max").');
      },
    });

    const parsed = parseNaturalAmount(customCtx.message.text.trim(), balanceCheck || 0);
    if (!parsed.success || !parsed.amount) {
      await ctx.reply(`${parsed.error || 'Invalid amount.'} LP cancelled.`);
      return;
    }
    amount = parsed.amount;

    if (parsed.description) {
      await ctx.reply(`Using: *${amount} SOL* (${parsed.description})`, { parse_mode: 'Markdown' });
    }
  } else {
    amount = parseFloat(amtData.split(':')[2]);
  }

  // Validate amount
  if (balanceCheck !== null && amount > balanceCheck - FEE_RESERVE) {
    await ctx.reply(
      `Not enough SOL. You have *${balanceCheck.toFixed(4)} SOL* but need *${amount} SOL* + ~${FEE_RESERVE} SOL for fees.\n\nTry a smaller amount or tap *Max*.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // ---- Step 3: Strategy Selection ----
  await ctx.reply(
    `Choose range strategy:`,
    { reply_markup: strategyKeyboard() },
  );

  const strCtx = await conversation.waitForCallbackQuery(/^(lp:str:[cmw]|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a strategy button above.');
    },
  });
  await strCtx.answerCallbackQuery();

  const strData = strCtx.callbackQuery.data;
  if (strData === 'cancel') {
    await strCtx.reply('LP cancelled.');
    return;
  }

  // Map strategy to bin/tick offset
  // c = tight (±2%), m = balanced (±5%), w = wide (±15%)
  const strategyMap: Record<string, { name: string; offset: number }> = {
    'lp:str:c': { name: 'tight', offset: 3 },      // ±2% range
    'lp:str:m': { name: 'balanced', offset: 8 },   // ±5% range  
    'lp:str:w': { name: 'wide', offset: 25 },      // ±15% range
  };
  const { name: strategyName, offset: binOffset } = strategyMap[strData] || strategyMap['lp:str:m'];
  const strategy: 'concentrated' | 'wide' = strData === 'lp:str:w' ? 'wide' : 'concentrated';

  // ---- Step 4: Distribution Shape (Meteora only) ----
  let shape: 'spot' | 'curve' | 'bidask' = 'spot';
  
  if (selectedPool.dex === 'meteora') {
    await ctx.reply(
      `Choose distribution shape:`,
      { reply_markup: distributionKeyboard() },
    );

    const distCtx = await conversation.waitForCallbackQuery(/^(lp:dist:(spot|curve|bidask)|cancel)$/, {
      otherwise: async (ctx) => {
        await ctx.reply('Please tap a distribution button above.');
      },
    });
    await distCtx.answerCallbackQuery();

    const distData = distCtx.callbackQuery.data;
    if (distData === 'cancel') {
      await distCtx.reply('LP cancelled.');
      return;
    }

    shape = distData.split(':')[2] as 'spot' | 'curve' | 'bidask';
  }

  // ---- Step 5: Confirmation ----
  const yieldEstimate = selectedPool.apr 
    ? `\nEstimated: *${estimateDailyYield(amount, selectedPool.apr)}* on your $${(amount * 100).toFixed(0)}`
    : '';

  const rangeDesc = binOffset <= 5 ? '±2%' : binOffset <= 10 ? '±5%' : '±15%';
  const strategyDesc = selectedPool.dex === 'meteora'
    ? `${strategyName} ${rangeDesc} (${shape})`
    : `${strategyName} ${rangeDesc}`;

  const summary = [
    `*Confirm LP Position*`,
    ``,
    `${dexLabel} *${selectedPool.name}*`,
    `Amount: *${amount} SOL*`,
    `Strategy: *${strategyDesc}*`,
    yieldEstimate,
    ``,
    `Your position will be:`,
    `• Encrypted with Arcium`,
    `• Bundled via Jito (MEV-protected)`,
    ``,
    `Confirm?`,
  ].join('\n');

  await ctx.reply(summary, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard('ulp'),
  });

  const cfCtx = await conversation.waitForCallbackQuery(/^(cf:ulp|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap Confirm or Cancel.');
    },
  });
  await cfCtx.answerCallbackQuery();

  if (cfCtx.callbackQuery.data === 'cancel') {
    await cfCtx.reply('LP cancelled.');
    return;
  }

  // ---- Step 6: Execute ----
  const lockKey = `lp-${selectedPool.dex}`;
  const lockAcquired = operationLock.tryAcquire(user.walletId, lockKey);
  if (!lockAcquired) {
    await ctx.reply('An LP operation is already in progress. Please wait for it to complete.');
    return;
  }

  await ctx.reply(
    `Executing LP position...\n\nEncrypting strategy with Arcium...\nBuilding transactions...\n\nThis may take 30-60 seconds.`,
  );

  const result = await conversation.external(async () => {
    try {
      const { client } = await loadWalletById(user.walletId);

      if (selectedPool.dex === 'orca') {
        // ---- Orca Whirlpool execution ----
        // Use direct RPC (signAndSendTransaction) - Privy's signTransaction doesn't work with partial signatures
        const params: OrcaLpExecuteParams = {
          walletId: user.walletId,
          walletAddress: user.walletAddress,
          poolAddress: selectedPool.address,
          amountSol: amount,
          strategy,
          tipSpeed: 'fast',
          slippageBps: 300,
          signTransaction: async (tx) => client.signTransaction(tx),
          signAndSendTransaction: async (tx) => client.signAndSendTransaction(tx),
        };

        const res = await executeOrcaLp(params);
        return {
          success: true as const,
          dex: 'orca' as const,
          txHashes: res.txHashes,
          bundleId: res.bundleId,
          status: res.status,
        };
      } else {
        // ---- Meteora DLMM execution ----
        // Use direct RPC path - Privy's signTransaction has issues with partial signatures
        const params: LpExecuteParams = {
          walletId: user.walletId,
          walletAddress: user.walletAddress,
          poolAddress: selectedPool.address,
          amountSol: amount,
          minBinId: -binOffset,
          maxBinId: binOffset,
          strategy,
          shape,
          tipSpeed: 'fast',
          slippageBps: 300,
          signTransaction: async (tx) => client.signTransaction(tx),
          signAndSendTransaction: async (tx) => client.signAndSendTransaction(tx),
        };

        const res = await executeLp(params);
        return {
          success: true as const,
          dex: 'meteora' as const,
          txHashes: res.txHashes,
          bundleId: res.bundleId,
          status: res.status,
        };
      }
    } catch (error: any) {
      console.error('[Unified LP] Execution error:', error);
      return { success: false as const, error: friendlyErrorMessage(error) };
    } finally {
      operationLock.release(user.walletId, lockKey);
    }
  });

  if (result.success) {
    const txRef = result.txHashes?.length
      ? `Tx: \`${result.txHashes[result.txHashes.length - 1]?.slice(0, 16)}...\``
      : result.bundleId
        ? `Bundle: \`${result.bundleId.slice(0, 16)}...\``
        : '';

    const text = [
      `*LP Position Created!* 🎉`,
      ``,
      `${dexLabel} *${selectedPool.name}*`,
      `Amount: ${amount} SOL`,
      `Strategy: ${strategyDesc}`,
      ``,
      `Encrypted with Arcium`,
      txRef,
      ``,
      `Use /positions to view your LP.`,
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(
      `*LP Failed*\n\n${result.error}\n\nYour tokens are safe in your wallet. Try again with /pools.`,
      { parse_mode: 'Markdown' },
    );
  }
}
