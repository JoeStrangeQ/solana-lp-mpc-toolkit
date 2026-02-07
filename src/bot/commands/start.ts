/**
 * /start command handler - Wallet creation / existing wallet display
 */
import type { BotContext } from '../types.js';
import { mainMenuKeyboard } from '../keyboards.js';
import { onboardTelegram, getWalletBalance } from '../../onboarding/index.js';
import { friendlyErrorMessage } from '../../utils/resilience.js';

export async function startCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  const username = ctx.from?.username;
  if (!chatId) return;

  try {
    const result = await onboardTelegram(chatId, username);

    // Store wallet info in session for quick access
    ctx.session.walletId = result.user.walletId;
    ctx.session.walletAddress = result.user.walletAddress;

    if (result.isNew) {
      const text = [
        `*MnM LP Agent Toolkit*`,
        ``,
        `Your wallet is ready\\!`,
        ``,
        `\`${result.user.walletAddress}\``,
        ``,
        `Send SOL to this address to get started\\.`,
        ``,
        `*Security:*`,
        `Your funds are secured by Privy MPC\\. Private keys are never exposed\\.`,
        ``,
        `Tap a button below or use /help for all commands\\.`,
      ].join('\n');

      await ctx.reply(text, {
        parse_mode: 'MarkdownV2',
        reply_markup: mainMenuKeyboard(),
      });
    } else {
      const balance = await getWalletBalance(result.user.walletAddress);
      const posCount = result.positions?.length || 0;
      const inRange = result.positions?.filter(p => p.inRange).length || 0;
      const addr = result.user.walletAddress;

      const text = [
        `*Welcome back\\!*`,
        ``,
        `Wallet: \`${addr}\``,
        `Balance: ${balance.sol.toFixed(4)} SOL`,
        `Positions: ${posCount} \\(${inRange} in range\\)`,
      ].join('\n');

      await ctx.reply(text, {
        parse_mode: 'MarkdownV2',
        reply_markup: mainMenuKeyboard(),
      });
    }
  } catch (error: any) {
    console.error('[Bot] /start error:', error);
    await ctx.reply(
      `Failed to initialize wallet. ${friendlyErrorMessage(error)}`,
    );
  }
}
