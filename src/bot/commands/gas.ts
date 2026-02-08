/**
 * /gas command handler - Show current Solana network fees
 */
import type { BotContext } from '../types.js';
import { getConnection } from '../../services/connection-pool.js';

export async function gasCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    await ctx.reply('⛽ Checking network fees...');
    
    const connection = getConnection();
    
    // Get recent prioritization fees
    const recentFees = await connection.getRecentPrioritizationFees({});
    
    if (recentFees.length === 0) {
      await ctx.reply('No recent fee data available.');
      return;
    }

    // Calculate statistics
    const fees = recentFees.map(f => f.prioritizationFee).filter(f => f > 0);
    
    if (fees.length === 0) {
      await ctx.reply(
        '*⛽ Network Fees*\n\n' +
        '✅ Network is quiet - minimal priority fees needed\n\n' +
        '_Base fee: ~0.000005 SOL per signature_',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const min = Math.min(...fees);
    const max = Math.max(...fees);
    const avg = fees.reduce((a, b) => a + b, 0) / fees.length;
    const median = fees.sort((a, b) => a - b)[Math.floor(fees.length / 2)];
    
    // Convert microlamports to lamports for display
    const formatFee = (microLamports: number) => {
      const lamports = microLamports / 1_000_000;
      if (lamports < 0.000001) return `${microLamports} µL`;
      return `${lamports.toFixed(6)} L`;
    };

    // Estimate cost for typical LP transaction (~400k CU)
    const typicalCU = 400_000;
    const estimatedCost = (median * typicalCU) / 1_000_000 / 1e9; // Convert to SOL
    
    // Determine congestion level
    let congestion = '🟢 Low';
    let recommendation = 'Standard fees will work fine';
    
    if (median > 10_000) {
      congestion = '🟡 Moderate';
      recommendation = 'Consider using "fast" tip speed';
    }
    if (median > 50_000) {
      congestion = '🟠 High';
      recommendation = 'Use "turbo" tip speed for reliability';
    }
    if (median > 100_000) {
      congestion = '🔴 Very High';
      recommendation = 'Network congested - expect higher fees';
    }

    const lines = [
      `*⛽ Solana Network Fees*`,
      ``,
      `Congestion: ${congestion}`,
      ``,
      `*Priority Fees (per CU)*`,
      `├ Min: ${formatFee(min)}`,
      `├ Median: ${formatFee(median)}`,
      `├ Avg: ${formatFee(Math.round(avg))}`,
      `└ Max: ${formatFee(max)}`,
      ``,
      `*Estimated LP Cost*`,
      `~${estimatedCost.toFixed(6)} SOL priority fee`,
      `+ 0.000005 SOL base fee`,
      ``,
      `💡 ${recommendation}`,
    ];

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('[Gas] Error:', error);
    await ctx.reply('Failed to fetch network fees. Try again later.');
  }
}
