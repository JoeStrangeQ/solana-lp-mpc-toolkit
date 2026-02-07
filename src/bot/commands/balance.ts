/**
 * /balance command handler
 */
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { getUserByChat, getWalletBalance } from '../../onboarding/index.js';

export async function balanceCommand(ctx: BotContext) {
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

    const balance = await getWalletBalance(user.walletAddress);

    const tokenLines =
      balance.tokens.length > 0
        ? balance.tokens
            .map((t) => {
              const usdStr = t.usd ? ` (~$${t.usd.toFixed(2)})` : '';
              return `  ${t.symbol}: ${t.amount.toFixed(4)}${usdStr}`;
            })
            .join('\n')
        : '  No tokens';

    const addrShort = `${user.walletAddress.slice(0, 8)}...${user.walletAddress.slice(-6)}`;

    const text = [
      `*Wallet Balance*`,
      ``,
      `Total: ~$${balance.totalUsd.toFixed(2)}`,
      ``,
      `SOL: ${balance.sol.toFixed(4)} (~$${balance.solUsd.toFixed(2)})`,
      ``,
      `Tokens:`,
      tokenLines,
      ``,
      `Address: \`${addrShort}\``,
    ].join('\n');

    const kb = new InlineKeyboard()
      .text('Refresh', 'cmd:balance')
      .text('Positions', 'cmd:positions')
      .row();

    if (balance.tokens.length > 0) {
      kb.text('Convert All to SOL', 'swap:all:sol');
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch (error: any) {
    console.error('[Bot] /balance error:', error);
    await ctx.reply('Failed to fetch balance. Please try again.');
  }
}
