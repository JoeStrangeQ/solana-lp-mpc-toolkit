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
    `/history - Recent transactions`,
    `/price SOL - Check token prices`,
    `/gas - Network fee status`,
    `/simulate 1 SOL - Estimate LP returns`,
    ``,
    `🏊 *Liquidity*`,
    `/pools - Browse top LP pools`,
    `/find SOL USDC - Search pools by tokens`,
    `/lp - Add liquidity wizard`,
    `/withdraw - Withdraw from positions`,
    `/claim - Claim fees without withdrawing`,
    `/rebalance - Rebalance out-of-range`,
    `/swap 1 SOL to USDC - Quick token swap`,
    ``,
    `⚙️ *Setup & Settings*`,
    `/start - Create or view wallet`,
    `/deposit - Get deposit address`,
    `/settings - Alert preferences`,
    `/alerts - View monitoring status`,
    `/status - System health check`,
    `/help - This message`,
    `/about - Toolkit info`,
    ``,
    `🔒 Encrypted with *Arcium* | MEV-protected via *Jito*`,
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
