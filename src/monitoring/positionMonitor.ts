/**
 * Position Monitoring Module
 * 
 * Tracks LP positions and alerts on:
 * 1. Position falling out of range
 * 2. Significant value changes (configurable %)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { debounceAlert } from '../utils/resilience.js';

// Minimum 15 minutes between out-of-range alerts for the same position
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export interface MonitoredPosition {
  positionAddress: string;
  poolAddress: string;
  binRange: { min: number; max: number };
  initialValue?: number; // USD value when position was created
  lastCheckedValue?: number;
  lastActiveBin?: number;
  alertsEnabled: {
    outOfRange: boolean;
    valueChange: number; // percentage threshold (e.g., 50 for 50%)
  };
  createdAt: string;
  lastChecked?: string;
}

export interface AlertResult {
  type: 'out_of_range' | 'value_change';
  positionAddress: string;
  message: string;
  data: Record<string, any>;
  timestamp: string;
}

export class PositionMonitor {
  private connection: Connection;
  private positions: Map<string, MonitoredPosition> = new Map();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl);
  }

  /**
   * Add a position to monitor
   */
  addPosition(position: MonitoredPosition): void {
    this.positions.set(position.positionAddress, position);
    console.log(`[Monitor] Tracking position ${position.positionAddress} (bins ${position.binRange.min} to ${position.binRange.max})`);
  }

  /**
   * Remove a position from monitoring
   */
  removePosition(positionAddress: string): void {
    this.positions.delete(positionAddress);
  }

  /**
   * Get all monitored positions
   */
  getPositions(): MonitoredPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check a single position for alerts
   */
  async checkPosition(positionAddress: string): Promise<AlertResult[]> {
    const position = this.positions.get(positionAddress);
    if (!position) {
      throw new Error(`Position ${positionAddress} not being monitored`);
    }

    const alerts: AlertResult[] = [];
    const now = new Date().toISOString();

    try {
      // Get pool info
      const pool = await DLMM.create(this.connection, new PublicKey(position.poolAddress));
      const activeBin = await pool.getActiveBin();
      const currentActiveBin = activeBin.binId;

      // 1. Check if out of range
      if (position.alertsEnabled.outOfRange) {
        const inRange = currentActiveBin >= position.binRange.min && 
                        currentActiveBin <= position.binRange.max;
        
        if (!inRange) {
          const direction = currentActiveBin < position.binRange.min ? 'below' : 'above';
          // Debounce: only alert once every 15 minutes per position
          if (debounceAlert(`oor:${positionAddress}`, ALERT_COOLDOWN_MS)) {
            alerts.push({
              type: 'out_of_range',
              positionAddress,
              message: `🚨 Position OUT OF RANGE! Active bin ${currentActiveBin} is ${direction} your range [${position.binRange.min}, ${position.binRange.max}]`,
              data: {
                activeBin: currentActiveBin,
                binRange: position.binRange,
                direction,
                pool: position.poolAddress,
              },
              timestamp: now,
            });
          }
        }
      }

      // 2. Check value change (simplified - uses bin position as proxy for now)
      // TODO: Implement actual USD value calculation
      if (position.alertsEnabled.valueChange > 0 && position.lastActiveBin !== undefined) {
        const binDelta = Math.abs(currentActiveBin - position.lastActiveBin);
        const binRange = position.binRange.max - position.binRange.min;
        const movePercent = (binDelta / binRange) * 100;

        if (movePercent >= position.alertsEnabled.valueChange) {
          if (debounceAlert(`vc:${positionAddress}`, ALERT_COOLDOWN_MS)) {
            alerts.push({
              type: 'value_change',
              positionAddress,
              message: `📊 Significant move detected! Price moved ~${movePercent.toFixed(1)}% (${binDelta} bins)`,
              data: {
                previousBin: position.lastActiveBin,
                currentBin: currentActiveBin,
                binDelta,
                movePercent,
              },
              timestamp: now,
            });
          }
        }
      }

      // Update tracking state
      position.lastActiveBin = currentActiveBin;
      position.lastChecked = now;
      this.positions.set(positionAddress, position);

      return alerts;
    } catch (error) {
      console.error(`[Monitor] Error checking position ${positionAddress}:`, error);
      throw error;
    }
  }

  /**
   * Check all monitored positions
   */
  async checkAllPositions(): Promise<AlertResult[]> {
    const allAlerts: AlertResult[] = [];

    for (const positionAddress of this.positions.keys()) {
      try {
        const alerts = await this.checkPosition(positionAddress);
        allAlerts.push(...alerts);
      } catch (error) {
        console.error(`[Monitor] Failed to check ${positionAddress}:`, error);
      }
    }

    return allAlerts;
  }

  /**
   * Get current status of a position (without generating alerts)
   */
  async getPositionStatus(positionAddress: string): Promise<{
    inRange: boolean;
    activeBin: number;
    binRange: { min: number; max: number };
    distanceFromRange: number;
  }> {
    const position = this.positions.get(positionAddress);
    if (!position) {
      throw new Error(`Position ${positionAddress} not being monitored`);
    }

    const pool = await DLMM.create(this.connection, new PublicKey(position.poolAddress));
    const activeBin = await pool.getActiveBin();
    const currentActiveBin = activeBin.binId;

    const inRange = currentActiveBin >= position.binRange.min && 
                    currentActiveBin <= position.binRange.max;
    
    let distanceFromRange = 0;
    if (!inRange) {
      distanceFromRange = currentActiveBin < position.binRange.min
        ? position.binRange.min - currentActiveBin
        : currentActiveBin - position.binRange.max;
    }

    return {
      inRange,
      activeBin: currentActiveBin,
      binRange: position.binRange,
      distanceFromRange,
    };
  }
}

// Singleton instance for use across the app
let monitorInstance: PositionMonitor | null = null;

export function getPositionMonitor(rpcUrl: string): PositionMonitor {
  if (!monitorInstance) {
    monitorInstance = new PositionMonitor(rpcUrl);
  }
  return monitorInstance;
}

export default PositionMonitor;
