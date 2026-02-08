/**
 * /alerts - Show position alert settings and recent alerts
 */

import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { InlineKeyboard } from 'grammy';

export async function alertsCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  try {
    // Get monitoring status from API
    const resp = await fetch('https://lp-agent-api-production.up.railway.app/health');
    const health = await resp.json() as any;
    
    const monitoring = health.monitoring || {};
    const positionsTracked = monitoring.positionsTracked || 0;
    const webhookConfigured = monitoring.webhookConfigured || false;
    const lastCheck = monitoring.lastCheck 
      ? new Date(monitoring.lastCheck).toLocaleTimeString()
      : 'Never';

    const text = [
      `*Position Monitoring*`,
      ``,
      `📊 Positions tracked: *${positionsTracked}*`,
      `🔔 Webhook: ${webhookConfigured ? '✅ Configured' : '❌ Not set'}`,
      `⏰ Last check: ${lastCheck}`,
      ``,
      `*Alert Types:*`,
      `• Out of range warnings`,
      `• Price movement alerts`,
      `• Rebalance recommendations`,
      ``,
      `Use /settings to configure alert preferences.`,
      `Use /positions to see individual position status.`,
    ].join('\n');

    const keyboard = new InlineKeyboard()
      .text('⚙️ Settings', 'set:main')
      .text('📊 Positions', 'pos:refresh');

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch (error: any) {
    console.error('[Alerts] Error:', error);
    await ctx.reply(`Error fetching alert status: ${error.message}`);
  }
}
