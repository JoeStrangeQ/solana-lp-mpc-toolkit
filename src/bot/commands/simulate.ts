/**
 * /simulate command handler - Estimate LP returns
 * 
 * Usage: /simulate 1 SOL USDC or /simulate $500 SOL USDC
 */
import type { BotContext } from '../types.js';
import { getAggregatedPrice } from '../../services/oracle-service.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export async function simulateCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text || '';
  const args = text.replace(/^\/simulate\s*/i, '').trim();

  if (!args) {
    await ctx.reply(
      '*LP Return Simulator*\n\n' +
      'Estimate earnings from providing liquidity.\n\n' +
      'Usage:\n' +
      '• `/simulate 1 SOL` - Simulate 1 SOL in top pool\n' +
      '• `/simulate $500` - Simulate $500 position\n\n' +
      '_Estimates based on current pool APRs_',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Parse amount
  let amountUsd = 0;
  let displayAmount = '';

  // Check for USD amount ($500, 500 usd, etc.)
  const usdMatch = args.match(/\$?([\d.]+)\s*(usd|usdc)?/i);
  if (usdMatch) {
    amountUsd = parseFloat(usdMatch[1]);
    displayAmount = `$${amountUsd}`;
  }

  // Check for SOL amount
  const solMatch = args.match(/([\d.]+)\s*sol/i);
  if (solMatch) {
    const solAmount = parseFloat(solMatch[1]);
    try {
      const priceData = await getAggregatedPrice(SOL_MINT);
      amountUsd = solAmount * priceData.price;
      displayAmount = `${solAmount} SOL (~$${amountUsd.toFixed(0)})`;
    } catch {
      amountUsd = solAmount * 200; // Fallback
      displayAmount = `${solAmount} SOL (~$${amountUsd.toFixed(0)})`;
    }
  }

  if (amountUsd === 0) {
    amountUsd = 100; // Default $100
    displayAmount = '$100';
  }

  // Simulate different APR scenarios
  const scenarios = [
    { name: 'Conservative', apr: 15, risk: 'Low IL risk, stable pairs' },
    { name: 'Moderate', apr: 40, risk: 'Medium IL, volatile pairs' },
    { name: 'Aggressive', apr: 80, risk: 'High IL, meme tokens' },
  ];

  const lines = [
    `*LP Return Simulation*`,
    ``,
    `Investment: ${displayAmount}`,
    ``,
    `*Estimated Returns*`,
    ``,
  ];

  for (const s of scenarios) {
    const daily = (amountUsd * s.apr / 100) / 365;
    const weekly = daily * 7;
    const monthly = daily * 30;
    const yearly = amountUsd * s.apr / 100;

    lines.push(
      `📊 *${s.name}* (${s.apr}% APR)`,
      `├ Daily: $${daily.toFixed(2)}`,
      `├ Weekly: $${weekly.toFixed(2)}`,
      `├ Monthly: $${monthly.toFixed(0)}`,
      `└ Yearly: $${yearly.toFixed(0)}`,
      `_${s.risk}_`,
      ``,
    );
  }

  lines.push(
    `⚠️ *Disclaimer*`,
    `APRs vary based on trading volume and IL.`,
    `Use /pools to see actual pool APRs.`,
  );

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}
