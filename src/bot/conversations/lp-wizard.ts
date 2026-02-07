/**
 * LP Wizard Conversation - Multi-step LP position creation
 *
 * Flow: select pool -> enter amount -> select strategy -> select distribution -> confirm -> execute
 *
 * Uses conversation.external() for all async service calls.
 * Uses conversation.waitForCallbackQuery() for button selections.
 * Uses conversation.waitFor("message:text") for text input.
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
import { loadWalletById, getWalletBalance } from '../../services/wallet-service.js';
import { validateSolAmount, validateSolanaAddress, friendlyErrorMessage } from '../../utils/resilience.js';
import { operationLock } from '../../utils/operation-lock.js';
import { consumePendingPool } from '../types.js';

interface PoolData {
  name: string;
  address: string;
  apr: number;
  tvl: number;
  binStep: number;
}

async function fetchTopPools(): Promise<PoolData[]> {
  const resp = await fetch('https://dlmm-api.meteora.ag/pair/all');
  if (!resp.ok) throw new Error('Meteora API failed');

  const all = (await resp.json()) as any[];
  return all
    .filter((p) => p.liquidity && parseFloat(p.liquidity) > 100_000 && !p.is_blacklisted)
    .sort((a: any, b: any) => (b.apr || 0) - (a.apr || 0))
    .slice(0, 6)
    .map((p: any) => ({
      name: p.name || 'Unknown',
      address: p.address,
      apr: parseFloat(p.apr || '0') * 100,
      tvl: parseFloat(p.liquidity || '0'),
      binStep: parseInt(p.bin_step || '10'),
    }));
}

export async function lpWizard(
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
  // Check if a pool was pre-selected from /pools command
  // Must use conversation.external() because ctx.session is not available in conversations
  const pendingPoolIndex = await conversation.external(() => {
    const chatId = ctx.chat?.id;
    if (!chatId) return undefined;
    return consumePendingPool(chatId);
  });

  const pools = await conversation.external(async () => {
    return fetchTopPools();
  });

  if (pools.length === 0) {
    await ctx.reply('Could not fetch pools. Please try again later.');
    return;
  }

  let selectedPool: { name: string; address: string; binStep: number };

  if (pendingPoolIndex !== undefined && pools[pendingPoolIndex]) {
    // Pool was pre-selected from /pools command — skip selection
    const p = pools[pendingPoolIndex];
    selectedPool = { name: p.name, address: p.address, binStep: p.binStep };
    await ctx.reply(`*Add Liquidity*\n\nPool: *${selectedPool.name}*`, { parse_mode: 'Markdown' });
  } else {
    // Show pool selection keyboard
    const { InlineKeyboard } = await import('grammy');
    const poolKb = new InlineKeyboard();
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      poolKb.text(`${p.name} (${p.apr.toFixed(1)}% APR)`, `lp:pool:${i}`).row();
    }
    poolKb.text('Enter pool address', 'lp:pool:custom').row();
    poolKb.text('Cancel', 'cancel');

    await ctx.reply('*Add Liquidity - Select Pool*\n\nChoose a pool:', {
      parse_mode: 'Markdown',
      reply_markup: poolKb,
    });

    // Wait for pool selection
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
      // Fetch pool info
      const poolInfo = await conversation.external(async () => {
        const resp = await fetch(`https://dlmm-api.meteora.ag/pair/${addr}`);
        if (!resp.ok) return null;
        return resp.json() as Promise<any>;
      });

      if (!poolInfo) {
        await ctx.reply('Pool not found. Please check the address and try again.');
        return;
      }
      selectedPool = {
        name: poolInfo.name || addr.slice(0, 8),
        address: addr,
        binStep: parseInt(poolInfo.bin_step || '10'),
      };
    } else {
      const poolIdx = parseInt(poolData.split(':')[2]);
      const p = pools[poolIdx];
      if (!p) {
        await ctx.reply('Invalid pool selection.');
        return;
      }
      selectedPool = { name: p.name, address: p.address, binStep: p.binStep };
    }
  }

  // ---- Step 2: Amount Selection ----
  await ctx.reply(
    `*Add Liquidity - Amount*\n\nPool: *${selectedPool.name}*\n\nHow much SOL?`,
    {
      parse_mode: 'Markdown',
      reply_markup: amountKeyboard(),
    },
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

  let amount: number;
  if (amtData === 'lp:amt:custom') {
    await ctx.reply('Enter the amount in SOL (e.g., 2.5):');
    const customCtx = await conversation.waitFor('message:text', {
      otherwise: async (ctx) => {
        await ctx.reply('Please send a number.');
      },
    });
    const parsed = parseFloat(customCtx.message.text.trim());
    const validation = validateSolAmount(parsed);
    if (isNaN(parsed) || !validation.valid) {
      await ctx.reply(`${validation.error || 'Invalid amount.'} LP cancelled.`);
      return;
    }
    amount = parsed;
  } else {
    amount = parseFloat(amtData.split(':')[2]);
  }

  // Validate amount against wallet balance
  const balanceCheck = await conversation.external(async () => {
    try {
      const bal = await getWalletBalance(user.walletAddress);
      return bal.sol;
    } catch {
      return null;
    }
  });

  if (balanceCheck !== null && amount > balanceCheck - 0.01) {
    await ctx.reply(
      `Insufficient SOL balance. You have ${balanceCheck.toFixed(4)} SOL but need at least ${amount} SOL plus fees. LP cancelled.`,
    );
    return;
  }

  // ---- Step 3: Strategy Selection ----
  await ctx.reply(
    `*Add Liquidity - Strategy*\n\nPool: *${selectedPool.name}*\nAmount: *${amount} SOL*\n\nChoose range strategy:`,
    {
      parse_mode: 'Markdown',
      reply_markup: strategyKeyboard(),
    },
  );

  const strCtx = await conversation.waitForCallbackQuery(/^(lp:str:[cw]|cancel)$/, {
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

  const strategy: 'concentrated' | 'wide' = strData === 'lp:str:c' ? 'concentrated' : 'wide';
  const binOffset = strategy === 'concentrated' ? 5 : 20;

  // ---- Step 4: Distribution Shape ----
  await ctx.reply(
    `*Add Liquidity - Distribution*\n\nPool: *${selectedPool.name}*\nAmount: *${amount} SOL*\nStrategy: *${strategy}* (+/- ${binOffset} bins)\n\nChoose distribution shape:`,
    {
      parse_mode: 'Markdown',
      reply_markup: distributionKeyboard(),
    },
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

  const shape = distData.split(':')[2] as 'spot' | 'curve' | 'bidask';

  // ---- Step 5: Confirmation ----
  const summary = [
    `*Confirm LP Position*`,
    ``,
    `Pool: *${selectedPool.name}*`,
    `Amount: *${amount} SOL*`,
    `Strategy: *${strategy}* (+/- ${binOffset} bins)`,
    `Distribution: *${shape}*`,
    ``,
    `Your position will be:`,
    `- Encrypted with Arcium`,
    `- Bundled via Jito (MEV-protected)`,
    ``,
    `Confirm?`,
  ].join('\n');

  await ctx.reply(summary, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard('lp'),
  });

  const cfCtx = await conversation.waitForCallbackQuery(/^(cf:lp|cancel)$/, {
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
  // Acquire operation lock to prevent double-tap
  const lockAcquired = operationLock.tryAcquire(user.walletId, 'lp');
  if (!lockAcquired) {
    await ctx.reply('An LP operation is already in progress. Please wait for it to complete.');
    return;
  }

  await ctx.reply(
    `Executing LP position...\n\nEncrypting strategy with Arcium...\nBuilding Jito bundle...\n\nThis may take 30-60 seconds.`,
  );

  const result = await conversation.external(async () => {
    try {
      const { client } = await loadWalletById(user.walletId);

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
        signTransaction: async (tx: string) => {
          return client.signTransaction(tx);
        },
      };

      const res = await executeLp(params);
      return { success: true as const, bundleId: res.bundleId, status: res.status };
    } catch (error: any) {
      console.error('[LP Wizard] Execution error:', error);
      return { success: false as const, error: friendlyErrorMessage(error) };
    } finally {
      operationLock.release(user.walletId, 'lp');
    }
  });

  if (result.success) {
    const text = [
      `*LP Position Created!*`,
      ``,
      `Pool: *${selectedPool.name}*`,
      `Amount: ${amount} SOL`,
      `Strategy: ${strategy} (${shape})`,
      ``,
      `Encrypted with Arcium`,
      `Bundled via Jito`,
      `Bundle: \`${result.bundleId?.slice(0, 16) || 'N/A'}...\``,
      ``,
      `Use /positions to view your LP.`,
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(
      `*LP Failed*\n\n${result.error}\n\nYour tokens are safe in your wallet. Try again with /lp.`,
      { parse_mode: 'Markdown' },
    );
  }
}
