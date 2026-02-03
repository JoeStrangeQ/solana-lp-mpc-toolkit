/**
 * Chat Display Formatter
 * Agent-native output formatting - speaks money, not crypto
 */

import { LPPool, LPPosition, DEXVenue } from '../adapters/types';

// ============ Types ============

export interface DisplayOptions {
  compact?: boolean;
  showLinks?: boolean;
  platform?: 'telegram' | 'discord' | 'whatsapp' | 'generic';
}

// ============ Formatters ============

/**
 * Format a number as currency
 */
export function formatUSD(amount: number): string {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1)}K`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

/**
 * Format daily earnings estimate
 */
export function formatDailyEarnings(pool: LPPool, amountUSD: number): string {
  const daily = (amountUSD * pool.apy / 365 / 100);
  return `~${formatUSD(daily)}/day`;
}

/**
 * Format APY in human terms
 */
export function describeAPY(apy: number): string {
  if (apy >= 200) return '🔥 Very High Risk';
  if (apy >= 100) return '⚡ High';
  if (apy >= 50) return '📈 Good';
  if (apy >= 20) return '📊 Moderate';
  if (apy >= 5) return '🏦 Stable';
  return '💤 Low';
}

/**
 * Format venue name nicely
 */
export function formatVenue(venue: DEXVenue): string {
  const names: Record<DEXVenue, string> = {
    meteora: 'Meteora',
    orca: 'Orca',
    raydium: 'Raydium',
    phoenix: 'Phoenix',
  };
  return names[venue] || venue;
}

/**
 * Format a pool for chat - agent native (shows money, not just %)
 */
export function formatPoolForAgent(
  pool: LPPool, 
  amountUSD?: number,
  options: DisplayOptions = {}
): string {
  const { compact = false } = options;
  
  const dailyEst = amountUSD ? formatDailyEarnings(pool, amountUSD) : '';
  const apyDesc = describeAPY(pool.apy);
  
  if (compact) {
    return `**${pool.name}** [${formatVenue(pool.venue)}] - ${pool.apy.toFixed(1)}% APY${dailyEst ? ` (${dailyEst})` : ''}`;
  }
  
  return `**${pool.name}** [${formatVenue(pool.venue)}]
├ APY: ${pool.apy.toFixed(1)}% ${apyDesc}${dailyEst ? ` → ${dailyEst}` : ''}
├ TVL: ${formatUSD(pool.tvl)}
├ Volume: ${formatUSD(pool.volume24h)}/day
└ Fee: ${pool.fee}%`;
}

/**
 * Format top pools as a recommendation
 */
export function formatPoolRecommendation(
  pools: LPPool[],
  amountUSD?: number,
  options: DisplayOptions = {}
): string {
  if (pools.length === 0) {
    return '🔍 No pools found matching your criteria.';
  }
  
  const { platform = 'generic' } = options;
  const top = pools[0];
  
  let output = '🏊 **Best LP Opportunities**\n\n';
  
  // Top recommendation with more detail
  const dailyEst = amountUSD ? formatDailyEarnings(top, amountUSD) : null;
  
  output += `🥇 **${top.name}** [${formatVenue(top.venue)}]\n`;
  output += `   ${top.apy.toFixed(1)}% APY`;
  if (dailyEst) output += ` → ${dailyEst}`;
  output += `\n   ${formatUSD(top.tvl)} TVL\n\n`;
  
  // Runners up (compact)
  if (pools.length > 1) {
    output += 'Also good:\n';
    pools.slice(1, 4).forEach((p, i) => {
      const emoji = ['🥈', '🥉', '4️⃣'][i];
      output += `${emoji} ${p.name} [${formatVenue(p.venue)}] - ${p.apy.toFixed(1)}%\n`;
    });
  }
  
  // Action prompt
  if (amountUSD) {
    output += `\n💡 Ready to add ${formatUSD(amountUSD)} to ${top.name}?`;
  } else {
    output += `\n💡 Tell me how much you want to add!`;
  }
  
  return output;
}

/**
 * Format a position for chat - agent native
 */
export function formatPositionForAgent(
  position: LPPosition,
  options: DisplayOptions = {}
): string {
  const { compact = false } = options;
  
  const rangeStatus = position.inRange ? '🟢' : '🔴 Out of range!';
  const fees = position.unclaimedFees.totalUSD;
  const feesStr = fees > 0.01 ? ` (+${formatUSD(fees)} to claim)` : '';
  
  if (compact) {
    return `${position.inRange ? '🟢' : '🔴'} **${position.poolName}** - ${formatUSD(position.valueUSD)}${feesStr}`;
  }
  
  return `${rangeStatus} **${position.poolName}** [${formatVenue(position.venue)}]
├ Value: ${formatUSD(position.valueUSD)}
├ Unclaimed: ${formatUSD(fees)}
├ Range: ${position.priceRange ? `${position.priceRange.lower.toFixed(4)} - ${position.priceRange.upper.toFixed(4)}` : 'Full range'}
└ ID: \`${position.positionId.slice(0, 8)}...\``;
}

/**
 * Format portfolio summary
 */
export function formatPortfolioSummary(
  positions: LPPosition[],
  options: DisplayOptions = {}
): string {
  if (positions.length === 0) {
    return `📭 **No LP Positions**

You don't have any active LP positions yet.

Want me to find some opportunities? Just say "find best LP" or tell me how much you want to put to work.`;
  }
  
  const totalValue = positions.reduce((sum, p) => sum + p.valueUSD, 0);
  const totalFees = positions.reduce((sum, p) => sum + p.unclaimedFees.totalUSD, 0);
  const inRange = positions.filter(p => p.inRange).length;
  const outOfRange = positions.length - inRange;
  
  let output = `📊 **Your LP Portfolio**\n\n`;
  output += `💰 Total Value: **${formatUSD(totalValue)}**\n`;
  output += `🎁 Unclaimed Fees: **${formatUSD(totalFees)}**\n`;
  
  if (outOfRange > 0) {
    output += `⚠️ ${outOfRange} position${outOfRange > 1 ? 's' : ''} out of range\n`;
  }
  
  output += `\n`;
  
  // List positions
  positions.forEach((pos, i) => {
    output += formatPositionForAgent(pos, { compact: true }) + '\n';
  });
  
  // Actions
  if (totalFees > 1) {
    output += `\n💡 You have ${formatUSD(totalFees)} in fees ready to claim!`;
  }
  if (outOfRange > 0) {
    output += `\n⚡ Some positions need rebalancing.`;
  }
  
  return output;
}

/**
 * Format operation result
 */
export function formatOperationResult(
  operation: 'add' | 'remove' | 'claim',
  success: boolean,
  details: {
    pool?: string;
    amount?: number;
    txSignature?: string;
    error?: string;
  }
): string {
  if (!success) {
    return `❌ **Operation Failed**\n\n${details.error || 'Unknown error'}`;
  }
  
  const txLink = details.txSignature 
    ? `\n🔗 [View Transaction](https://solscan.io/tx/${details.txSignature})`
    : '';
  
  switch (operation) {
    case 'add':
      return `✅ **Liquidity Added!**

Pool: ${details.pool}
Amount: ${formatUSD(details.amount || 0)}${txLink}

I'll keep an eye on this position for you.`;
    
    case 'remove':
      return `✅ **Liquidity Removed!**

Pool: ${details.pool}
Received: ${formatUSD(details.amount || 0)}${txLink}`;
    
    case 'claim':
      return `✅ **Fees Claimed!**

Pool: ${details.pool}
Amount: ${formatUSD(details.amount || 0)}${txLink}`;
    
    default:
      return `✅ **Operation Complete**${txLink}`;
  }
}

export default {
  formatUSD,
  formatDailyEarnings,
  describeAPY,
  formatVenue,
  formatPoolForAgent,
  formatPoolRecommendation,
  formatPositionForAgent,
  formatPortfolioSummary,
  formatOperationResult,
};
