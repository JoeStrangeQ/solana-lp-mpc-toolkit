/**
 * /deposit command handler - Show deposit address
 */
import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';

export async function depositCommand(ctx: BotContext) {
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

    const text = [
      `*Deposit Address*`,
      ``,
      `Send SOL or SPL tokens to:`,
      ``,
      `\`${user.walletAddress}\``,
      ``,
      `*Important:*`,
      `- Only send Solana assets`,
      `- Minimum deposit: 0.01 SOL`,
      `- Deposits are available immediately`,
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('[Bot] /deposit error:', error);
    await ctx.reply('Failed to retrieve deposit address. Please try again.');
  }
}
