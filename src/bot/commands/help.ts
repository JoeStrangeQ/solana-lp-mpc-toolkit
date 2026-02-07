/**
 * /help command handler
 */
import type { BotContext } from '../types.js';

export async function helpCommand(ctx: BotContext) {
  const text = [
    `*MnM LP Toolkit Commands*`,
    ``,
    `/start - Create wallet or show existing`,
    `/balance - Check wallet balance`,
    `/pools - Browse top LP pools`,
    `/positions - View your LP positions`,
    `/deposit - Get deposit address`,
    `/withdraw - Withdraw from LP positions`,
    `/settings - Alert preferences`,
    `/help - This message`,
    ``,
    `*Multi-step Wizards:*`,
    `/lp - Add liquidity wizard`,
    `/rebalance - Rebalance a position`,
    ``,
    `All transactions encrypted with *Arcium*`,
    `MEV-protected via *Jito bundles*`,
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
