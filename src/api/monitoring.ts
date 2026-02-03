/**
 * Yield Monitoring Service
 * Proactive alerts for AI agents about LP positions
 *
 * Features:
 * - Position out-of-range alerts
 * - Yield threshold notifications
 * - Rebalance suggestions
 * - APY change tracking
 */

import { Connection, PublicKey } from "@solana/web3.js";

// ============ Types ============

export interface MonitoringAlert {
  type:
    | "out_of_range"
    | "yield_drop"
    | "yield_spike"
    | "rebalance_needed"
    | "fee_harvest";
  severity: "info" | "warning" | "urgent";
  positionId?: string;
  poolAddress?: string;
  message: string;
  suggestion: string;
  data: Record<string, any>;
  timestamp: number;
}

export interface PositionHealth {
  positionId: string;
  poolName: string;
  venue: string;
  inRange: boolean;
  currentPrice: number;
  rangeMin: number;
  rangeMax: number;
  utilizationPercent: number; // How much of range is being used
  healthScore: number; // 0-100
  unclaimedFeesUSD: number;
  daysSinceLastHarvest: number;
  alerts: MonitoringAlert[];
}

export interface PoolHealthCheck {
  poolAddress: string;
  poolName: string;
  venue: string;
  currentAPY: number;
  apy24hAgo: number;
  apy7dAgo: number;
  apyChange24h: number; // Percentage change
  tvlChange24h: number; // Percentage change
  volumeChange24h: number; // Percentage change
  healthScore: number;
  alerts: MonitoringAlert[];
}

// ============ Alert Generators ============

export function checkPositionHealth(position: {
  positionId: string;
  poolName: string;
  venue: string;
  currentPrice: number;
  rangeMin: number;
  rangeMax: number;
  unclaimedFeesUSD: number;
  lastHarvestTime?: number;
}): PositionHealth {
  const alerts: MonitoringAlert[] = [];
  const now = Date.now();

  // Check if in range
  const inRange =
    position.currentPrice >= position.rangeMin &&
    position.currentPrice <= position.rangeMax;

  // Calculate utilization (how close to edge of range)
  const rangeWidth = position.rangeMax - position.rangeMin;
  const pricePosition = position.currentPrice - position.rangeMin;
  const utilizationPercent = (pricePosition / rangeWidth) * 100;

  // Out of range alert
  if (!inRange) {
    const direction =
      position.currentPrice < position.rangeMin ? "below" : "above";
    alerts.push({
      type: "out_of_range",
      severity: "urgent",
      positionId: position.positionId,
      message: `Position is out of range (price ${direction} your range)`,
      suggestion: `Consider rebalancing to a new range around current price ${position.currentPrice.toFixed(4)}`,
      data: {
        currentPrice: position.currentPrice,
        rangeMin: position.rangeMin,
        rangeMax: position.rangeMax,
      },
      timestamp: now,
    });
  }

  // Near edge of range warning
  if (inRange && (utilizationPercent < 10 || utilizationPercent > 90)) {
    alerts.push({
      type: "rebalance_needed",
      severity: "warning",
      positionId: position.positionId,
      message: `Price near edge of range (${utilizationPercent.toFixed(0)}% utilized)`,
      suggestion:
        "Consider widening range or rebalancing soon to avoid going out of range",
      data: { utilizationPercent },
      timestamp: now,
    });
  }

  // Unclaimed fees alert
  if (position.unclaimedFeesUSD > 50) {
    alerts.push({
      type: "fee_harvest",
      severity: "info",
      positionId: position.positionId,
      message: `$${position.unclaimedFeesUSD.toFixed(2)} in unclaimed fees`,
      suggestion: "Consider harvesting fees to compound or realize profits",
      data: { unclaimedFeesUSD: position.unclaimedFeesUSD },
      timestamp: now,
    });
  }

  // Calculate health score
  let healthScore = 100;
  if (!inRange) healthScore -= 50;
  if (utilizationPercent < 10 || utilizationPercent > 90) healthScore -= 20;
  if (position.unclaimedFeesUSD > 100) healthScore -= 10; // Should harvest
  healthScore = Math.max(0, healthScore);

  // Days since last harvest
  const daysSinceLastHarvest = position.lastHarvestTime
    ? (now - position.lastHarvestTime) / (1000 * 60 * 60 * 24)
    : 0;

  return {
    positionId: position.positionId,
    poolName: position.poolName,
    venue: position.venue,
    inRange,
    currentPrice: position.currentPrice,
    rangeMin: position.rangeMin,
    rangeMax: position.rangeMax,
    utilizationPercent,
    healthScore,
    unclaimedFeesUSD: position.unclaimedFeesUSD,
    daysSinceLastHarvest,
    alerts,
  };
}

export function checkPoolHealth(pool: {
  poolAddress: string;
  poolName: string;
  venue: string;
  currentAPY: number;
  apy24hAgo?: number;
  apy7dAgo?: number;
  currentTVL: number;
  tvl24hAgo?: number;
}): PoolHealthCheck {
  const alerts: MonitoringAlert[] = [];
  const now = Date.now();

  const apy24hAgo = pool.apy24hAgo || pool.currentAPY;
  const apy7dAgo = pool.apy7dAgo || pool.currentAPY;
  const tvl24hAgo = pool.tvl24hAgo || pool.currentTVL;

  const apyChange24h = ((pool.currentAPY - apy24hAgo) / apy24hAgo) * 100;
  const tvlChange24h = ((pool.currentTVL - tvl24hAgo) / tvl24hAgo) * 100;

  // APY spike alert (good opportunity)
  if (apyChange24h > 50) {
    alerts.push({
      type: "yield_spike",
      severity: "info",
      poolAddress: pool.poolAddress,
      message: `APY spiked ${apyChange24h.toFixed(0)}% in 24h`,
      suggestion: "Good opportunity to add liquidity if sustainable",
      data: {
        currentAPY: pool.currentAPY,
        previousAPY: apy24hAgo,
        change: apyChange24h,
      },
      timestamp: now,
    });
  }

  // APY drop alert
  if (apyChange24h < -30) {
    alerts.push({
      type: "yield_drop",
      severity: "warning",
      poolAddress: pool.poolAddress,
      message: `APY dropped ${Math.abs(apyChange24h).toFixed(0)}% in 24h`,
      suggestion: "Consider moving liquidity to higher-yield pools",
      data: {
        currentAPY: pool.currentAPY,
        previousAPY: apy24hAgo,
        change: apyChange24h,
      },
      timestamp: now,
    });
  }

  // TVL drop warning (potential liquidity issues)
  if (tvlChange24h < -20) {
    alerts.push({
      type: "yield_drop",
      severity: "warning",
      poolAddress: pool.poolAddress,
      message: `TVL dropped ${Math.abs(tvlChange24h).toFixed(0)}% in 24h`,
      suggestion: "Other LPs are leaving - investigate before adding more",
      data: { currentTVL: pool.currentTVL, change: tvlChange24h },
      timestamp: now,
    });
  }

  // Calculate health score
  let healthScore = 100;
  if (apyChange24h < -30) healthScore -= 30;
  if (tvlChange24h < -20) healthScore -= 20;
  if (pool.currentTVL < 100000) healthScore -= 20; // Low TVL
  healthScore = Math.max(0, healthScore);

  return {
    poolAddress: pool.poolAddress,
    poolName: pool.poolName,
    venue: pool.venue,
    currentAPY: pool.currentAPY,
    apy24hAgo,
    apy7dAgo,
    apyChange24h,
    tvlChange24h,
    volumeChange24h: 0, // Would need historical data
    healthScore,
    alerts,
  };
}

// ============ Formatted Output for Agents ============

export function formatHealthReport(positions: PositionHealth[]): string {
  if (positions.length === 0) {
    return "📭 No positions to monitor";
  }

  const urgentAlerts = positions.flatMap((p) =>
    p.alerts.filter((a) => a.severity === "urgent"),
  );
  const warnings = positions.flatMap((p) =>
    p.alerts.filter((a) => a.severity === "warning"),
  );

  let report = `📊 **Position Health Report**\n\n`;

  if (urgentAlerts.length > 0) {
    report += `🚨 **${urgentAlerts.length} Urgent Alert(s)**\n`;
    urgentAlerts.forEach((a) => {
      report += `• ${a.message}\n  → ${a.suggestion}\n`;
    });
    report += "\n";
  }

  if (warnings.length > 0) {
    report += `⚠️ **${warnings.length} Warning(s)**\n`;
    warnings.forEach((a) => {
      report += `• ${a.message}\n`;
    });
    report += "\n";
  }

  report += `**Position Summary**\n`;
  positions.forEach((p) => {
    const status = p.inRange ? "🟢" : "🔴";
    report += `${status} ${p.poolName} - Health: ${p.healthScore}/100\n`;
    if (p.unclaimedFeesUSD > 0) {
      report += `   💰 $${p.unclaimedFeesUSD.toFixed(2)} unclaimed\n`;
    }
  });

  return report;
}

export function formatPoolReport(pools: PoolHealthCheck[]): string {
  let report = `📈 **Pool Health Report**\n\n`;

  const opportunities = pools.filter((p) =>
    p.alerts.some((a) => a.type === "yield_spike"),
  );
  const warnings = pools.filter((p) =>
    p.alerts.some((a) => a.severity === "warning"),
  );

  if (opportunities.length > 0) {
    report += `🎯 **Opportunities**\n`;
    opportunities.forEach((p) => {
      report += `• ${p.poolName}: APY up ${p.apyChange24h.toFixed(0)}% → ${p.currentAPY.toFixed(1)}%\n`;
    });
    report += "\n";
  }

  if (warnings.length > 0) {
    report += `⚠️ **Watch List**\n`;
    warnings.forEach((p) => {
      report += `• ${p.poolName}: ${p.alerts[0].message}\n`;
    });
    report += "\n";
  }

  return report;
}

export default {
  checkPositionHealth,
  checkPoolHealth,
  formatHealthReport,
  formatPoolReport,
};
