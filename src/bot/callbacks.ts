/**
 * Callback query handlers for inline keyboard buttons
 *
 * Handles callbacks that are NOT part of a conversation wizard.
 * Conversation wizards handle their own callbacks via waitForCallbackQuery().
 */
import type { BotContext } from './types.js';
import {
  getRecipient,
  upsertRecipient,
  getWalletByChatId,
} from '../notifications/index.js';
import { getUserByChat, getUserPositions, type PositionDetails } from '../onboarding/index.js';

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
    if (!isNaN(poolIdx)) {
      ctx.session.pendingPoolIndex = poolIdx;
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

  // ---- Withdraw shortcut (from positions view) ----
  if (data.startsWith('wd:') && !data.startsWith('wd:sel:') && !data.startsWith('wd:cf:')) {
    await ctx.answerCallbackQuery().catch(() => {});
    // Enter withdraw wizard
    await ctx.conversation.enter('withdrawWizard');
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
