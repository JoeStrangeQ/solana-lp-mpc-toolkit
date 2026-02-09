/**
 * DCA Setup Wizard
 * 
 * Flow: Select Pool → Enter Total Budget → Enter Amount Per Execution → Select Interval → Confirm
 */

import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { getWalletBalance } from '../../services/wallet-service.js';
import { parseNaturalAmount } from '../../utils/natural-amounts.js';
import {
  createDCASchedule,
  formatInterval,
  type DCAInterval,
} from '../../services/dca-service.js';
import { fetchUnifiedPools } from '../../services/unified-pools.js';

/**
 * DCA Setup Wizard
 */
export async function dcaWizard(
  conversation: Conversation<BotContext, BotContext>,
  ctx: BotContext,
) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await conversation.external(() => getUserByChat(chatId));
  if (!user) {
    await ctx.reply('Please run /start first.');
    return;
  }

  // Get balance
  const balance = await conversation.external(() => getWalletBalance(user.walletId));
  const availableSol = balance.sol - 0.15; // Reserve for fees

  if (availableSol < 0.1) {
    await ctx.reply(
      `Insufficient balance for DCA.\n\n` +
      `You have ${balance.sol.toFixed(4)} SOL, but need at least 0.25 SOL (0.1 minimum + 0.15 fee reserve).`,
    );
    return;
  }

  // ---- Step 1: Select Pool ----
  await ctx.reply('🔍 Fetching top pools across all DEXes...');
  
  const pools = await conversation.external(() => 
    fetchUnifiedPools({ limit: 8, sortBy: 'riskAdjustedYield' })
  );

  if (pools.length === 0) {
    await ctx.reply('Failed to fetch pools. Please try again.');
    return;
  }

  const poolLines = pools.map((p, i) => {
    const dexIcon = p.dex === 'meteora' ? '🌙' : p.dex === 'orca' ? '🐋' : '⚡';
    return `${i + 1}. ${dexIcon} *${p.name}* - ${p.apr.toFixed(1)}% APR`;
  }).join('\n');

  const poolKb = new InlineKeyboard();
  pools.forEach((p, i) => {
    const dexIcon = p.dex === 'meteora' ? '🌙' : p.dex === 'orca' ? '🐋' : '⚡';
    poolKb.text(`${dexIcon} ${p.name}`, `dca:pool:${i}`);
    if ((i + 1) % 2 === 0) poolKb.row();
  });
  poolKb.row().text('Cancel', 'cancel');

  await ctx.reply(
    `*Select Pool for DCA*\n\n${poolLines}`,
    { parse_mode: 'Markdown', reply_markup: poolKb }
  );

  const poolCtx = await conversation.waitForCallbackQuery(/^(dca:pool:\d+|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a pool button above.');
    },
  });
  await poolCtx.answerCallbackQuery();

  if (poolCtx.callbackQuery.data === 'cancel') {
    await poolCtx.reply('DCA setup cancelled.');
    return;
  }

  const poolIdx = parseInt(poolCtx.callbackQuery.data.split(':')[2]);
  const selectedPool = pools[poolIdx];

  // ---- Step 2: Total Budget ----
  await ctx.reply(
    `*Total Budget*\n\n` +
    `Pool: *${selectedPool.name}*\n` +
    `Available: ${availableSol.toFixed(2)} SOL\n\n` +
    `How much SOL total do you want to DCA?\n` +
    `_e.g. "5", "half", "10 SOL"_`,
    { parse_mode: 'Markdown' }
  );

  const budgetMsg = await conversation.waitFor('message:text', {
    otherwise: async (ctx) => {
      await ctx.reply('Please enter an amount.');
    },
  });

  const parsedBudget = parseNaturalAmount(budgetMsg.message.text, availableSol);
  if (!parsedBudget.success || !parsedBudget.amount) {
    await ctx.reply(`${parsedBudget.error || 'Invalid amount.'}. Minimum is 0.1 SOL. DCA setup cancelled.`);
    return;
  }
  const totalBudget = parsedBudget.amount;
  
  if (totalBudget < 0.1) {
    await ctx.reply('Amount too small. Minimum is 0.1 SOL. DCA setup cancelled.');
    return;
  }
  if (totalBudget > availableSol) {
    await ctx.reply(`Amount exceeds available balance (${availableSol.toFixed(2)} SOL). DCA setup cancelled.`);
    return;
  }

  // ---- Step 3: Amount Per Execution ----
  await ctx.reply(
    `*Amount Per Deposit*\n\n` +
    `Total budget: ${totalBudget} SOL\n\n` +
    `How much SOL per deposit?\n` +
    `_This determines how many deposits you'll make._`,
    { parse_mode: 'Markdown' }
  );

  const amountMsg = await conversation.waitFor('message:text', {
    otherwise: async (ctx) => {
      await ctx.reply('Please enter an amount.');
    },
  });

  const parsedAmount = parseNaturalAmount(amountMsg.message.text, totalBudget);
  if (!parsedAmount.success || !parsedAmount.amount) {
    await ctx.reply(`${parsedAmount.error || 'Invalid amount.'}. Minimum is 0.05 SOL per deposit. DCA setup cancelled.`);
    return;
  }
  const amountPerExec = parsedAmount.amount;
  
  if (amountPerExec < 0.05) {
    await ctx.reply('Amount too small. Minimum is 0.05 SOL per deposit. DCA setup cancelled.');
    return;
  }
  if (amountPerExec > totalBudget) {
    await ctx.reply('Amount per deposit cannot exceed total budget. DCA setup cancelled.');
    return;
  }

  const numExecutions = Math.floor(totalBudget / amountPerExec);

  // ---- Step 4: Interval ----
  const intervalKb = new InlineKeyboard()
    .text('Hourly', 'dca:int:1h')
    .text('Every 4h', 'dca:int:4h')
    .row()
    .text('Twice Daily', 'dca:int:12h')
    .text('Daily', 'dca:int:24h')
    .row()
    .text('Weekly', 'dca:int:7d')
    .row()
    .text('Cancel', 'cancel');

  await ctx.reply(
    `*Select Interval*\n\n` +
    `${amountPerExec} SOL × ${numExecutions} deposits = ${(amountPerExec * numExecutions).toFixed(2)} SOL\n\n` +
    `How often should deposits run?`,
    { parse_mode: 'Markdown', reply_markup: intervalKb }
  );

  const intCtx = await conversation.waitForCallbackQuery(/^(dca:int:(1h|4h|12h|24h|7d)|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap an interval button above.');
    },
  });
  await intCtx.answerCallbackQuery();

  if (intCtx.callbackQuery.data === 'cancel') {
    await intCtx.reply('DCA setup cancelled.');
    return;
  }

  const interval = intCtx.callbackQuery.data.split(':')[2] as DCAInterval;

  // ---- Step 5: Strategy ----
  const stratKb = new InlineKeyboard()
    .text('Tight (±2%)', 'dca:str:tight')
    .text('Balanced (±5%)', 'dca:str:balanced')
    .text('Wide (±15%)', 'dca:str:wide')
    .row()
    .text('Cancel', 'cancel');

  await ctx.reply(
    `*Select Strategy*\n\n` +
    `• Tight: Higher fees, needs frequent rebalancing\n` +
    `• Balanced: Good mix of yield and stability\n` +
    `• Wide: Set and forget, lower yield`,
    { parse_mode: 'Markdown', reply_markup: stratKb }
  );

  const strCtx = await conversation.waitForCallbackQuery(/^(dca:str:(tight|balanced|wide)|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a strategy button above.');
    },
  });
  await strCtx.answerCallbackQuery();

  if (strCtx.callbackQuery.data === 'cancel') {
    await strCtx.reply('DCA setup cancelled.');
    return;
  }

  const strategy = strCtx.callbackQuery.data.split(':')[2] as 'tight' | 'balanced' | 'wide';

  // ---- Step 6: Confirm ----
  const dexIcon = selectedPool.dex === 'meteora' ? '🌙' : selectedPool.dex === 'orca' ? '🐋' : '⚡';
  const summary = [
    `*Confirm DCA Setup*`,
    ``,
    `${dexIcon} Pool: *${selectedPool.name}*`,
    `Total Budget: *${totalBudget} SOL*`,
    `Per Deposit: *${amountPerExec} SOL*`,
    `Deposits: *${numExecutions}*`,
    `Interval: *${formatInterval(interval)}*`,
    `Strategy: *${strategy}*`,
    ``,
    `First deposit will run in ~${interval}.`,
    ``,
    `Confirm?`,
  ].join('\n');

  const confirmKb = new InlineKeyboard()
    .text('✅ Start DCA', 'dca:confirm')
    .text('❌ Cancel', 'cancel');

  await ctx.reply(summary, { parse_mode: 'Markdown', reply_markup: confirmKb });

  const cfCtx = await conversation.waitForCallbackQuery(/^(dca:confirm|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap Confirm or Cancel.');
    },
  });
  await cfCtx.answerCallbackQuery();

  if (cfCtx.callbackQuery.data === 'cancel') {
    await cfCtx.reply('DCA setup cancelled.');
    return;
  }

  // ---- Create Schedule ----
  try {
    const schedule = await conversation.external(() =>
      createDCASchedule({
        walletId: user.walletId,
        walletAddress: user.walletAddress,
        chatId,
        poolAddress: selectedPool.address,
        poolName: selectedPool.name,
        dex: selectedPool.dex,
        amountPerExecution: amountPerExec,
        totalBudget,
        interval,
        strategy,
      })
    );

    await ctx.reply(
      `*DCA Started!* ✅\n\n` +
      `${dexIcon} *${selectedPool.name}*\n` +
      `${amountPerExec} SOL ${formatInterval(interval).toLowerCase()}\n` +
      `${numExecutions} deposits over ${getDurationString(interval, numExecutions)}\n\n` +
      `I'll notify you after each deposit.\n\n` +
      `Use /dca to view or manage your schedules.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    console.error('[DCA Wizard] Error creating schedule:', error);
    await ctx.reply(`Failed to create DCA schedule: ${error.message}`);
  }
}

function getDurationString(interval: DCAInterval, count: number): string {
  const hours: Record<DCAInterval, number> = {
    '1h': 1,
    '4h': 4,
    '12h': 12,
    '24h': 24,
    '7d': 168,
  };
  const totalHours = hours[interval] * count;
  
  if (totalHours < 24) return `${totalHours} hours`;
  if (totalHours < 168) return `${Math.round(totalHours / 24)} days`;
  return `${Math.round(totalHours / 168)} weeks`;
}
