/**
 * /withdraw command handler - Enters the withdraw wizard conversation
 */
import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';

export async function withdrawCommand(ctx: BotContext) {
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

    await ctx.conversation.enter('withdrawWizard');
  } catch (error: any) {
    console.error('[Bot] /withdraw error:', error);
    await ctx.reply('Failed to start withdrawal. Please try again.');
  }
}
