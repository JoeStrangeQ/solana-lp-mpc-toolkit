/**
 * /help command handler
 */
import type { BotContext } from '../types.js';

export async function helpCommand(ctx: BotContext) {
  const text = [
    `*MnM LP Toolkit Commands*`,
    ``,
    `📊 *Overview*`,
    `/portfolio - Total value & health summary`,
    `/positions - View LP positions with IL`,
    `/balance - Wallet balance`,
    ``,
    `🏊 *Liquidity*`,
    `/pools - Browse top LP pools`,
    `/lp - Add liquidity wizard`,
    `/withdraw - Withdraw from positions`,
    `/rebalance - Rebalance out-of-range`,
    ``,
    `⚙️ *Settings*`,
    `/deposit - Get deposit address`,
    `/settings - Alert preferences`,
    `/help - This message`,
    ``,
    `🔒 Encrypted with *Arcium* | MEV-protected via *Jito*`,
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
