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
    `/export - Export position data`,
    `/price SOL - Check token prices`,
    `/gas - Network fee status`,
    `/simulate 1 SOL - Estimate LP returns`,
    ``,
    `🏊 *Liquidity*`,
    `/pools - Browse top LP pools`,
    `/find SOL USDC - Search pools by tokens`,
    `/lp - Add liquidity (Meteora/Orca/Raydium)`,
    `/withdraw - Withdraw from positions`,
    `/claim - Claim fees without withdrawing`,
    `/rebalance - Rebalance out-of-range`,
    `/swap 1 SOL to USDC - Quick token swap`,
    `/dca - Dollar-cost average into LP`,
    ``,
    `🔔 *Monitoring*`,
    `/track - Auto-discover & track all positions`,
    `/alerts - View monitoring status`,
    `/settings - Alert & notification preferences`,
    ``,
    `⚙️ *Setup*`,
    `/start - Create or view wallet`,
    `/deposit - Get deposit address`,
    `/status - System health check`,
    `/help - This message`,
    `/tips - LP best practices`,
    `/about - Toolkit info`,
    ``,
    `*Powered by:* 3 DEXes (Meteora, Orca, Raydium)`,
    `🔒 Arcium encryption | ⚡ Jito MEV protection`,
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
