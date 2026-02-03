/**
 * Yield Monitor for Agents
 * Tracks LP positions and generates natural language updates
 *
 * This is what makes it agent-native:
 * - Monitors positions automatically
 * - Generates human-readable updates
 * - Alerts on important events (out of range, high fees to claim, etc.)
 * - Formatted for chat interfaces
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { YieldScanner, createYieldScanner } from "./yieldScanner";
import { LPPosition, DEXVenue } from "../adapters/types";
import { formatUSD } from "../api/chatDisplay";

// ============ Types ============

export interface YieldUpdate {
  timestamp: number;
  type: "summary" | "alert" | "milestone" | "rebalance_needed";
  priority: "low" | "medium" | "high" | "urgent";

  // Natural language message for the agent
  message: string;

  // Structured data (optional, for programmatic use)
  data?: {
    positionId?: string;
    venue?: DEXVenue;
    poolName?: string;
    valueUSD?: number;
    feesUSD?: number;
    apy?: number;
    inRange?: boolean;
  };
}

export interface MonitorConfig {
  checkIntervalMs: number; // How often to check (default: 5 min)
  alertThresholds: {
    feesReadyUSD: number; // Alert when fees > this (default: $1)
    outOfRangeMinutes: number; // Alert after X min out of range
    valueChangePercent: number; // Alert on X% value change
  };
  naturalLanguage: boolean; // Always true for agents
}

// ============ Default Config ============

const DEFAULT_CONFIG: MonitorConfig = {
  checkIntervalMs: 5 * 60 * 1000, // 5 minutes
  alertThresholds: {
    feesReadyUSD: 1.0,
    outOfRangeMinutes: 30,
    valueChangePercent: 5,
  },
  naturalLanguage: true,
};

// ============ Yield Monitor Class ============

export class YieldMonitor {
  private connection: Connection;
  private scanner: YieldScanner;
  private ownerPubkey: PublicKey;
  private config: MonitorConfig;

  // Track state for delta detection
  private lastPositions: Map<string, LPPosition> = new Map();
  private lastCheck: number = 0;
  private outOfRangeSince: Map<string, number> = new Map();

  constructor(
    connection: Connection,
    ownerPubkey: PublicKey,
    config: Partial<MonitorConfig> = {},
  ) {
    this.connection = connection;
    this.ownerPubkey = ownerPubkey;
    this.scanner = createYieldScanner(connection);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check positions and generate natural language updates
   */
  async checkAndReport(): Promise<YieldUpdate[]> {
    const updates: YieldUpdate[] = [];
    const now = Date.now();

    // Get current positions
    const aggregated = await this.scanner.getAggregatedPositions(
      this.ownerPubkey,
    );
    const positions = aggregated.positions;

    // If first check, just store state
    if (this.lastCheck === 0) {
      this.storeState(positions);
      this.lastCheck = now;

      // Generate initial summary
      if (positions.length > 0) {
        updates.push(this.generateSummary(aggregated));
      }
      return updates;
    }

    // Check each position for updates
    for (const pos of positions) {
      const lastPos = this.lastPositions.get(pos.positionId);

      // New position
      if (!lastPos) {
        updates.push({
          timestamp: now,
          type: "milestone",
          priority: "medium",
          message: `📥 New LP position detected: ${pos.poolName} on ${pos.venue} worth ${formatUSD(pos.valueUSD)}`,
          data: {
            positionId: pos.positionId,
            venue: pos.venue,
            poolName: pos.poolName,
            valueUSD: pos.valueUSD,
          },
        });
        continue;
      }

      // Check if out of range
      if (!pos.inRange) {
        const outSince = this.outOfRangeSince.get(pos.positionId);
        if (!outSince) {
          this.outOfRangeSince.set(pos.positionId, now);
        } else {
          const minutesOut = (now - outSince) / 60000;
          if (minutesOut >= this.config.alertThresholds.outOfRangeMinutes) {
            updates.push({
              timestamp: now,
              type: "rebalance_needed",
              priority: "high",
              message: `⚠️ Your ${pos.poolName} position has been out of range for ${Math.round(minutesOut)} minutes. You're not earning fees. Consider rebalancing.`,
              data: {
                positionId: pos.positionId,
                venue: pos.venue,
                poolName: pos.poolName,
                inRange: false,
              },
            });
          }
        }
      } else {
        this.outOfRangeSince.delete(pos.positionId);
      }

      // Check fees ready to claim
      const feesDelta =
        pos.unclaimedFees.totalUSD - (lastPos.unclaimedFees?.totalUSD || 0);
      if (
        pos.unclaimedFees.totalUSD >=
          this.config.alertThresholds.feesReadyUSD &&
        feesDelta > 0
      ) {
        updates.push({
          timestamp: now,
          type: "alert",
          priority: "low",
          message: `💰 ${pos.poolName}: You have ${formatUSD(pos.unclaimedFees.totalUSD)} in fees ready to claim (+${formatUSD(feesDelta)} since last check)`,
          data: {
            positionId: pos.positionId,
            poolName: pos.poolName,
            feesUSD: pos.unclaimedFees.totalUSD,
          },
        });
      }

      // Check significant value change
      const valueChange =
        ((pos.valueUSD - lastPos.valueUSD) / lastPos.valueUSD) * 100;
      if (
        Math.abs(valueChange) >= this.config.alertThresholds.valueChangePercent
      ) {
        const direction = valueChange > 0 ? "📈" : "📉";
        updates.push({
          timestamp: now,
          type: "alert",
          priority: "medium",
          message: `${direction} ${pos.poolName}: Position value changed ${valueChange > 0 ? "+" : ""}${valueChange.toFixed(1)}% (now ${formatUSD(pos.valueUSD)})`,
          data: {
            positionId: pos.positionId,
            poolName: pos.poolName,
            valueUSD: pos.valueUSD,
          },
        });
      }
    }

    // Check for closed positions
    for (const [posId, lastPos] of this.lastPositions) {
      if (!positions.find((p) => p.positionId === posId)) {
        updates.push({
          timestamp: now,
          type: "milestone",
          priority: "medium",
          message: `📤 Position closed: ${lastPos.poolName} (was worth ${formatUSD(lastPos.valueUSD)})`,
          data: {
            positionId: posId,
            poolName: lastPos.poolName,
          },
        });
      }
    }

    // Store new state
    this.storeState(positions);
    this.lastCheck = now;

    return updates;
  }

  /**
   * Generate a natural language summary of all positions
   */
  generateSummary(aggregated: {
    positions: LPPosition[];
    totalValueUSD: number;
    totalUnclaimedUSD: number;
    byVenue: Record<string, { count: number; valueUSD: number }>;
  }): YieldUpdate {
    const { positions, totalValueUSD, totalUnclaimedUSD, byVenue } = aggregated;

    if (positions.length === 0) {
      return {
        timestamp: Date.now(),
        type: "summary",
        priority: "low",
        message: `📊 No active LP positions. Want me to find some opportunities?`,
      };
    }

    const inRange = positions.filter((p) => p.inRange).length;
    const outOfRange = positions.length - inRange;

    // Build natural language summary
    let message = `📊 **Your LP Portfolio**\n\n`;
    message += `💰 Total value: ${formatUSD(totalValueUSD)}\n`;
    message += `🎁 Unclaimed fees: ${formatUSD(totalUnclaimedUSD)}\n`;
    message += `📍 ${positions.length} positions (${inRange} in range`;
    if (outOfRange > 0) message += `, ⚠️ ${outOfRange} out of range`;
    message += `)\n\n`;

    // Per-venue breakdown
    message += `**By DEX:**\n`;
    for (const [venue, data] of Object.entries(byVenue)) {
      if (data.count > 0) {
        message += `• ${venue}: ${data.count} positions (${formatUSD(data.valueUSD)})\n`;
      }
    }

    // Action items
    if (totalUnclaimedUSD > 5) {
      message += `\n💡 You have ${formatUSD(totalUnclaimedUSD)} in fees to claim!`;
    }
    if (outOfRange > 0) {
      message += `\n⚠️ ${outOfRange} position${outOfRange > 1 ? "s need" : " needs"} rebalancing.`;
    }

    return {
      timestamp: Date.now(),
      type: "summary",
      priority: outOfRange > 0 ? "medium" : "low",
      message,
      data: {
        valueUSD: totalValueUSD,
        feesUSD: totalUnclaimedUSD,
      },
    };
  }

  /**
   * Generate a quick status one-liner
   */
  async getQuickStatus(): Promise<string> {
    const aggregated = await this.scanner.getAggregatedPositions(
      this.ownerPubkey,
    );

    if (aggregated.positions.length === 0) {
      return "No LP positions active.";
    }

    const inRange = aggregated.positions.filter((p) => p.inRange).length;
    const outOfRange = aggregated.positions.length - inRange;

    let status = `${aggregated.positions.length} LP positions worth ${formatUSD(aggregated.totalValueUSD)}`;
    if (aggregated.totalUnclaimedUSD > 0.01) {
      status += ` (+${formatUSD(aggregated.totalUnclaimedUSD)} fees)`;
    }
    if (outOfRange > 0) {
      status += ` ⚠️ ${outOfRange} out of range`;
    }

    return status;
  }

  /**
   * Get estimated daily yield in natural language
   */
  async getDailyYieldEstimate(): Promise<string> {
    const aggregated = await this.scanner.getAggregatedPositions(
      this.ownerPubkey,
    );

    if (aggregated.positions.length === 0) {
      return "No positions to calculate yield.";
    }

    // Rough estimate: average APY across positions
    // In production: would get actual pool APYs
    const avgAPY = 35; // Placeholder
    const dailyYield = (aggregated.totalValueUSD * avgAPY) / 365 / 100;

    return `Estimated earnings: ~${formatUSD(dailyYield)}/day based on ${formatUSD(aggregated.totalValueUSD)} in LP positions.`;
  }

  private storeState(positions: LPPosition[]): void {
    this.lastPositions.clear();
    for (const pos of positions) {
      this.lastPositions.set(pos.positionId, { ...pos });
    }
  }
}

// Factory
export function createYieldMonitor(
  connection: Connection,
  ownerPubkey: PublicKey,
  config?: Partial<MonitorConfig>,
): YieldMonitor {
  return new YieldMonitor(connection, ownerPubkey, config);
}

export default YieldMonitor;
