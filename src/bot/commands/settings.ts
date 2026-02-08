/**
 * /settings command handler - Alert preferences with frequency/threshold
 */
import type { BotContext } from '../types.js';
import { settingsKeyboard } from '../keyboards.js';
import { getUserByChat } from '../../onboarding/index.js';

export async function settingsCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    const user = await getUserByChat(chatId);

    if (!user) {
      await ctx.reply('No wallet found. Use /start to create one.');
      return;
    }

    ctx.session.walletId = user.walletId;
    ctx.session.walletAddress = user.walletAddress;

    const prefs = user.preferences;
    const threshold = prefs.alertOnValueChange || 0;
    const quietEnabled = !!prefs.quietHours;

    const text = [
      `*🔧 Alert Settings*`,
      ``,
      `🔔 Out of Range: ${prefs.alertOnOutOfRange ? 'ON' : 'OFF'}`,
      `⚡ Auto-Rebalance: ${prefs.autoRebalance ? 'ON' : 'OFF'}`,
      `📊 Daily Summary: ${prefs.dailySummary ? 'ON' : 'OFF'}`,
      `📏 Alert Threshold: ${threshold > 0 ? `${threshold}% change` : 'Any change'}`,
      `🌙 Quiet Hours: ${quietEnabled ? `${prefs.quietHours?.start}:00-${prefs.quietHours?.end}:00 UTC` : 'OFF'}`,
      ``,
      `Tap to configure:`,
    ].join('\n');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: settingsKeyboard(user.walletId, {
        alertOnOutOfRange: prefs.alertOnOutOfRange,
        autoRebalance: prefs.autoRebalance,
        dailySummary: prefs.dailySummary,
        alertThreshold: threshold,
        quietHoursEnabled: quietEnabled,
      }),
    });
  } catch (error: any) {
    console.error('[Bot] /settings error:', error);
    await ctx.reply('Failed to load settings. Please try again.');
  }
}
