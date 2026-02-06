/**
 * Background Monitoring Worker
 * 
 * Runs continuously to:
 * 1. Check all tracked positions every interval
 * 2. Process alert queue and deliver notifications
 * 3. Execute autonomous actions (if enabled)
 * 4. Log all activity for audit trail
 * 
 * Designed to survive API restarts via Redis state.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { config } from '../config/index.js';
import {
  getAllTrackedPositions,
  updatePositionStatus,
  getUserSettings,
  getUserRules,
  updateRuleTriggered,
  type TrackedPosition,
  type UserSettings,
} from './userRules.js';
// Alert queue removed - using unified notification system
import {
  sendAlert as sendNotification,
  getRecipient,
  type AlertPayload,
} from '../notifications/index.js';
import { Redis } from '@upstash/redis';

// Worker state keys
const KEYS = {
  WORKER_STATE: 'lp-toolkit:worker:state',
  WORKER_LOGS: 'lp-toolkit:worker:logs',
  LAST_CHECK: 'lp-toolkit:worker:lastCheck',
  CHECK_COUNT: 'lp-toolkit:worker:checkCount',
};

export interface WorkerState {
  running: boolean;
  lastCheck: string | null;
  lastAlertProcess: string | null;
  checksCompleted: number;
  alertsDelivered: number;
  errors: number;
  startedAt: string | null;
}

export interface WorkerLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, any>;
}

// Worker configuration
const POSITION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LOG_ENTRIES = 500;

// Runtime state
let isRunning = false;
let positionCheckTimer: NodeJS.Timeout | null = null;
let connection: Connection | null = null;

// Redis client
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) return null;
  
  redis = new Redis({ url, token });
  return redis;
}

// ============ Logging ============

async function log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, any>): Promise<void> {
  const entry: WorkerLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };
  
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📋';
  console.log(`[Worker] ${prefix} ${message}`, data ? JSON.stringify(data) : '');
  
  const client = getRedis();
  if (client) {
    try {
      await client.lpush(KEYS.WORKER_LOGS, JSON.stringify(entry));
      await client.ltrim(KEYS.WORKER_LOGS, 0, MAX_LOG_ENTRIES - 1);
    } catch (e) {
      // Ignore logging errors
    }
  }
}

// ============ Worker State ============

async function getWorkerState(): Promise<WorkerState> {
  const client = getRedis();
  
  const defaultState: WorkerState = {
    running: isRunning,
    lastCheck: null,
    lastAlertProcess: null,
    checksCompleted: 0,
    alertsDelivered: 0,
    errors: 0,
    startedAt: null,
  };
  
  if (!client) return defaultState;
  
  try {
    const state = await client.get<WorkerState>(KEYS.WORKER_STATE);
    return { ...defaultState, ...state, running: isRunning };
  } catch (e) {
    return defaultState;
  }
}

async function updateWorkerState(updates: Partial<WorkerState>): Promise<void> {
  const client = getRedis();
  if (!client) return;
  
  try {
    const current = await getWorkerState();
    const newState = { ...current, ...updates };
    await client.set(KEYS.WORKER_STATE, newState);
  } catch (e) {
    // Ignore state update errors
  }
}

// ============ Position Checking ============

async function checkAllPositions(): Promise<void> {
  const now = new Date().toISOString();
  
  await log('info', 'Starting position check cycle');
  
  try {
    const positions = await getAllTrackedPositions();
    
    if (positions.length === 0) {
      await log('info', 'No positions to check');
      await updateWorkerState({ lastCheck: now });
      return;
    }
    
    await log('info', `Checking ${positions.length} positions`);
    
    if (!connection) {
      connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    }
    
    let checkedCount = 0;
    let alertsQueued = 0;
    
    for (const position of positions) {
      try {
        const result = await checkPosition(position);
        checkedCount++;
        
        if (result.alertQueued) {
          alertsQueued++;
        }
      } catch (error: any) {
        await log('error', `Failed to check position ${position.positionAddress}`, { error: error.message });
      }
    }
    
    await log('info', `Check cycle complete: ${checkedCount} checked, ${alertsQueued} alerts queued`);
    
    const state = await getWorkerState();
    await updateWorkerState({
      lastCheck: now,
      checksCompleted: state.checksCompleted + 1,
    });
    
  } catch (error: any) {
    await log('error', 'Position check cycle failed', { error: error.message });
    const state = await getWorkerState();
    await updateWorkerState({ errors: state.errors + 1 });
  }
}

async function checkPosition(position: TrackedPosition): Promise<{ alertQueued: boolean }> {
  if (!connection) {
    connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
  }
  
  const pool = await DLMM.create(connection, new PublicKey(position.poolAddress));
  const activeBin = await pool.getActiveBin();
  const currentBin = activeBin.binId;
  
  const inRange = currentBin >= position.binRange.lower && currentBin <= position.binRange.upper;
  const wasInRange = position.lastInRange !== false;
  const now = new Date().toISOString();
  
  // Update position status
  await updatePositionStatus(position.userId, position.positionAddress, {
    lastChecked: now,
    lastInRange: inRange,
    outOfRangeSince: inRange ? undefined : (position.outOfRangeSince || now),
  });
  
  // Check if we need to alert
  let alertQueued = false;
  
  if (!inRange && wasInRange) {
    // Just went out of range!
    await log('warn', `Position ${position.positionAddress} went OUT OF RANGE`, {
      pool: position.poolName,
      currentBin,
      range: position.binRange,
    });
    
    // Get user settings for delivery
    // Calculate distance from range
    const direction = currentBin < position.binRange.lower ? 'below' : 'above';
    const distance = currentBin < position.binRange.lower
      ? position.binRange.lower - currentBin
      : currentBin - position.binRange.upper;
    
    // Check if recipient is registered for notifications
    const recipient = await getRecipient(position.walletId || position.userId);
    
    if (recipient) {
      // Send via unified notification system
      const alertPayload: AlertPayload = {
        event: 'out_of_range',
        walletId: position.walletId || position.userId,
        timestamp: now,
        position: {
          address: position.positionAddress,
          poolName: position.poolName,
          poolAddress: position.poolAddress,
        },
        details: {
          message: `Position is ${distance} bins ${direction} your range`,
          currentBin,
          binRange: position.binRange,
          direction,
          distance,
        },
        action: {
          suggested: 'rebalance',
          endpoint: 'POST /lp/rebalance/execute',
          method: 'POST',
          params: {
            walletId: position.walletId,
            poolAddress: position.poolAddress,
            positionAddress: position.positionAddress,
          },
        },
      };
      
      const results = await sendNotification(position.walletId || position.userId, alertPayload);
      alertQueued = results.telegram?.success || results.webhook?.success || false;
      
      if (alertQueued) {
        await log('info', `Alert sent for ${position.poolName}`, { 
          telegram: results.telegram?.success, 
          webhook: results.webhook?.success 
        });
      }
    }
  } else if (inRange && !wasInRange) {
    // Just came back in range
    await log('info', `Position ${position.positionAddress} is back IN RANGE`, {
      pool: position.poolName,
      currentBin,
    });
    
    // Send back-in-range notification
    const recipient = await getRecipient(position.walletId || position.userId);
    
    if (recipient?.preferences.alertOnBackInRange) {
      const alertPayload: AlertPayload = {
        event: 'back_in_range',
        walletId: position.walletId || position.userId,
        timestamp: now,
        position: {
          address: position.positionAddress,
          poolName: position.poolName,
          poolAddress: position.poolAddress,
        },
        details: {
          message: 'Position is back in range and earning fees!',
          currentBin,
          binRange: position.binRange,
        },
      };
      
      await sendNotification(position.walletId || position.userId, alertPayload);
    }
  }
  
  return { alertQueued };
}

// Alert processing now handled directly in checkPosition via unified notification system

// ============ Worker Control ============

/**
 * Start the background worker
 */
export async function startWorker(): Promise<void> {
  if (isRunning) {
    await log('warn', 'Worker already running');
    return;
  }
  
  isRunning = true;
  const startTime = new Date().toISOString();
  
  await log('info', '🚀 Starting background monitoring worker');
  await updateWorkerState({ running: true, startedAt: startTime });
  
  // Initial check
  await checkAllPositions();
  
  // Start position check interval
  positionCheckTimer = setInterval(async () => {
    if (isRunning) {
      await checkAllPositions();
    }
  }, POSITION_CHECK_INTERVAL_MS);
  
  await log('info', `Worker started. Position check interval: ${POSITION_CHECK_INTERVAL_MS / 1000}s`);
}

/**
 * Stop the background worker
 */
export async function stopWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }
  
  isRunning = false;
  
  if (positionCheckTimer) {
    clearInterval(positionCheckTimer);
    positionCheckTimer = null;
  }
  
  await log('info', '🛑 Worker stopped');
  await updateWorkerState({ running: false });
}

/**
 * Check if worker is running
 */
export function isWorkerRunning(): boolean {
  return isRunning;
}

/**
 * Get worker status
 */
export async function getWorkerStatus(): Promise<WorkerState & { logs: WorkerLog[] }> {
  const state = await getWorkerState();
  const client = getRedis();
  
  let logs: WorkerLog[] = [];
  if (client) {
    try {
      const rawLogs = await client.lrange(KEYS.WORKER_LOGS, 0, 49);
      logs = rawLogs.map(l => typeof l === 'string' ? JSON.parse(l) : l as unknown as WorkerLog);
    } catch (e) {
      // Ignore
    }
  }
  
  return { ...state, logs };
}

/**
 * Force an immediate position check
 */
export async function triggerPositionCheck(): Promise<void> {
  await log('info', 'Manual position check triggered');
  await checkAllPositions();
}
