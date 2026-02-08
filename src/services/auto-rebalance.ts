/**
 * Auto-Rebalance Service
 * 
 * Detects out-of-range positions and provides rebalancing recommendations.
 * Can execute rebalance: withdraw → swap → re-deposit at new range.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config/index.js';

export interface RebalanceAnalysis {
  positionAddress: string;
  poolAddress: string;
  poolName: string;
  dex: 'meteora' | 'orca';
  
  /** Current status */
  inRange: boolean;
  currentPrice: number;
  lowerBound: number;
  upperBound: number;
  
  /** Position in range (0-100, -ve if below, >100 if above) */
  rangePosition: number;
  
  /** Recommendation */
  action: 'hold' | 'monitor' | 'rebalance_soon' | 'rebalance_now';
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  
  /** Suggested new range (if rebalance recommended) */
  suggestedRange?: {
    lower: number;
    upper: number;
    strategy: 'centered' | 'asymmetric';
  };
  
  /** Estimated values */
  estimatedValue: number;
  estimatedFees: number;
}

export interface RebalanceParams {
  positionAddress: string;
  poolAddress: string;
  dex: 'meteora' | 'orca';
  walletId: string;
  walletAddress: string;
  newRangeLower: number;
  newRangeUpper: number;
  slippageBps?: number;
}

/**
 * Analyze a position and determine if rebalancing is needed
 */
export function analyzePosition(params: {
  positionAddress: string;
  poolAddress: string;
  poolName: string;
  dex: 'meteora' | 'orca';
  currentPrice: number;
  lowerBound: number;
  upperBound: number;
  estimatedValue?: number;
  estimatedFees?: number;
}): RebalanceAnalysis {
  const {
    positionAddress,
    poolAddress,
    poolName,
    dex,
    currentPrice,
    lowerBound,
    upperBound,
    estimatedValue = 0,
    estimatedFees = 0,
  } = params;

  const range = upperBound - lowerBound;
  const rangePosition = ((currentPrice - lowerBound) / range) * 100;
  const inRange = currentPrice >= lowerBound && currentPrice <= upperBound;

  let action: RebalanceAnalysis['action'] = 'hold';
  let reason = 'Position is healthy';
  let urgency: RebalanceAnalysis['urgency'] = 'low';
  let suggestedRange: RebalanceAnalysis['suggestedRange'] | undefined;

  if (!inRange) {
    // Out of range - critical
    action = 'rebalance_now';
    urgency = 'critical';
    
    if (currentPrice < lowerBound) {
      const percentBelow = ((lowerBound - currentPrice) / lowerBound) * 100;
      reason = `Price ${percentBelow.toFixed(1)}% below range - not earning fees`;
      
      // Suggest new range centered on current price
      const rangeWidth = upperBound - lowerBound;
      suggestedRange = {
        lower: currentPrice - rangeWidth * 0.4,
        upper: currentPrice + rangeWidth * 0.6,
        strategy: 'asymmetric',
      };
    } else {
      const percentAbove = ((currentPrice - upperBound) / upperBound) * 100;
      reason = `Price ${percentAbove.toFixed(1)}% above range - not earning fees`;
      
      const rangeWidth = upperBound - lowerBound;
      suggestedRange = {
        lower: currentPrice - rangeWidth * 0.6,
        upper: currentPrice + rangeWidth * 0.4,
        strategy: 'asymmetric',
      };
    }
  } else if (rangePosition < 10 || rangePosition > 90) {
    // Near edge - high urgency
    action = 'rebalance_soon';
    urgency = 'high';
    
    if (rangePosition < 10) {
      reason = `Price near lower edge (${rangePosition.toFixed(0)}%) - may exit range soon`;
    } else {
      reason = `Price near upper edge (${rangePosition.toFixed(0)}%) - may exit range soon`;
    }
    
    // Suggest re-centering
    const rangeWidth = upperBound - lowerBound;
    suggestedRange = {
      lower: currentPrice - rangeWidth * 0.5,
      upper: currentPrice + rangeWidth * 0.5,
      strategy: 'centered',
    };
  } else if (rangePosition < 20 || rangePosition > 80) {
    // Getting close to edge - monitor
    action = 'monitor';
    urgency = 'medium';
    reason = `Price at ${rangePosition.toFixed(0)}% of range - monitor closely`;
  } else {
    // Healthy position
    action = 'hold';
    urgency = 'low';
    reason = `Price at ${rangePosition.toFixed(0)}% of range - earning fees`;
  }

  return {
    positionAddress,
    poolAddress,
    poolName,
    dex,
    inRange,
    currentPrice,
    lowerBound,
    upperBound,
    rangePosition,
    action,
    reason,
    urgency,
    suggestedRange,
    estimatedValue,
    estimatedFees,
  };
}

/**
 * Format rebalance analysis for display
 */
export function formatRebalanceAnalysis(analysis: RebalanceAnalysis): string {
  const urgencyEmoji = {
    low: '✅',
    medium: '⚡',
    high: '⚠️',
    critical: '🔴',
  };

  const lines = [
    `${urgencyEmoji[analysis.urgency]} *${analysis.poolName}* (${analysis.dex})`,
    ``,
    `Status: ${analysis.inRange ? 'IN RANGE' : 'OUT OF RANGE'}`,
    `Current: $${analysis.currentPrice.toFixed(2)}`,
    `Range: $${analysis.lowerBound.toFixed(2)} - $${analysis.upperBound.toFixed(2)}`,
    `Position: ${analysis.rangePosition.toFixed(0)}%`,
    ``,
    `*Action:* ${analysis.action.replace('_', ' ').toUpperCase()}`,
    `${analysis.reason}`,
  ];

  if (analysis.suggestedRange) {
    lines.push(
      ``,
      `*Suggested New Range:*`,
      `$${analysis.suggestedRange.lower.toFixed(2)} - $${analysis.suggestedRange.upper.toFixed(2)}`,
      `Strategy: ${analysis.suggestedRange.strategy}`,
    );
  }

  return lines.join('\n');
}

/**
 * Check all positions and return those needing attention
 */
export async function checkAllPositions(walletAddress: string): Promise<RebalanceAnalysis[]> {
  const { getUserPositions } = await import('../onboarding/index.js');
  const { getOrcaPositionsForWallet } = await import('./orca-service.js');

  const analyses: RebalanceAnalysis[] = [];

  // Check Meteora positions
  try {
    const meteoraPositions = await getUserPositions(walletAddress);
    for (const pos of meteoraPositions) {
      const analysis = analyzePosition({
        positionAddress: pos.address,
        poolAddress: pos.poolAddress,
        poolName: pos.pool,
        dex: 'meteora',
        currentPrice: pos.priceRange.current,
        lowerBound: pos.priceRange.lower,
        upperBound: pos.priceRange.upper,
      });
      
      if (analysis.action !== 'hold') {
        analyses.push(analysis);
      }
    }
  } catch (err) {
    console.error('[AutoRebalance] Error checking Meteora positions:', err);
  }

  // Check Orca positions
  try {
    const orcaPositions = await getOrcaPositionsForWallet(walletAddress);
    for (const pos of orcaPositions) {
      const analysis = analyzePosition({
        positionAddress: pos.address,
        poolAddress: pos.poolAddress,
        poolName: pos.poolName,
        dex: 'orca',
        currentPrice: pos.priceCurrent,
        lowerBound: pos.priceLower,
        upperBound: pos.priceUpper,
      });
      
      if (analysis.action !== 'hold') {
        analyses.push(analysis);
      }
    }
  } catch (err) {
    console.error('[AutoRebalance] Error checking Orca positions:', err);
  }

  // Sort by urgency
  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  analyses.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return analyses;
}

/**
 * Get summary of all positions needing attention
 */
export async function getRebalanceSummary(walletAddress: string): Promise<string> {
  const analyses = await checkAllPositions(walletAddress);

  if (analyses.length === 0) {
    return '✅ All positions healthy - no rebalancing needed';
  }

  const critical = analyses.filter(a => a.urgency === 'critical').length;
  const high = analyses.filter(a => a.urgency === 'high').length;
  const medium = analyses.filter(a => a.urgency === 'medium').length;

  const lines = [
    `*Rebalance Summary*`,
    ``,
  ];

  if (critical > 0) {
    lines.push(`🔴 ${critical} position(s) OUT OF RANGE`);
  }
  if (high > 0) {
    lines.push(`⚠️ ${high} position(s) near edge`);
  }
  if (medium > 0) {
    lines.push(`⚡ ${medium} position(s) to monitor`);
  }

  lines.push(``);

  // Add top 3 most urgent
  for (const analysis of analyses.slice(0, 3)) {
    lines.push(`• ${analysis.poolName}: ${analysis.reason}`);
  }

  return lines.join('\n');
}
