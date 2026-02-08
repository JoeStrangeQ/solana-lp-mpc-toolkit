/**
 * /refresh - Force refresh of cached data
 */

import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { invalidatePositionCache } from '../../services/lp-service.js';

export async function refreshCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  await ctx.reply('🔄 Refreshing cached data...');

  try {
    // Clear position cache
    await invalidatePositionCache(user.walletId);
    
    // Clear any other caches here in the future
    
    await ctx.reply(
      `*Cache Refreshed!* ✅\n\n` +
      `Position data cleared. Use /positions to reload fresh data.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    console.error('[Refresh] Error:', error);
    await ctx.reply(`Refresh failed: ${error.message}`);
  }
}
