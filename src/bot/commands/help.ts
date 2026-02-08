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
    `/price SOL - Check token prices`,
    `/gas - Network fee status`,
    `/simulate 1 SOL - Estimate LP returns`,
    ``,
    `🏊 *Liquidity*`,
    `/pools - Browse top LP pools`,
    `/find SOL USDC - Search pools by tokens`,
    `/lp - Add liquidity wizard`,
    `/withdraw - Withdraw from positions`,
    `/rebalance - Rebalance out-of-range`,
    ``,
    `⚙️ *Setup & Settings*`,
    `/start - Create or view wallet`,
    `/deposit - Get deposit address`,
    `/settings - Alert preferences`,
    `/status - System health check`,
    `/help - This message`,
    `/about - Toolkit info`,
    ``,
    `🔒 Encrypted with *Arcium* | MEV-protected via *Jito*`,
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
