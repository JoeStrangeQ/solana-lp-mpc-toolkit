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
import {
  queueOutOfRangeAlert,
  queueRebalancePrompt,
  queueDailySummary,
  getReadyAlerts,
  markProcessing,
  markDelivered,
  markRetry,
  type QueuedAlert,
} from './alertQueue.js';
import {
  sendOutOfRangeAlert,
  sendRebalancePrompt,
  sendDailySummary,
  sendAlert,
} from './telegram.js';
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
const ALERT_PROCESS_INTERVAL_MS = 10 * 1000; // 10 seconds
const MAX_LOG_ENTRIES = 500;

// Runtime state
let isRunning = false;
let positionCheckTimer: NodeJS.Timeout | null = null;
let alertProcessTimer: NodeJS.Timeout | null = null;
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
    const settings = await getUserSettings(position.userId);
    
    if (settings?.preferences.alertOnOutOfRange) {
      await queueOutOfRangeAlert({
        userId: position.userId,
        positionAddress: position.positionAddress,
        poolName: position.poolName,
        currentBin,
        binRange: position.binRange,
        telegramChatId: settings.telegram?.chatId,
      });
      alertQueued = true;
      
      // Check if we should prompt for rebalance
      if (!settings.preferences.autoRebalance) {
        // Calculate how far out of range
        const distance = currentBin < position.binRange.lower
          ? position.binRange.lower - currentBin
          : currentBin - position.binRange.upper;
        const rangeWidth = position.binRange.upper - position.binRange.lower;
        const percentOut = (distance / rangeWidth) * 100;
        
        if (percentOut >= settings.preferences.rebalanceThreshold) {
          await queueRebalancePrompt({
            userId: position.userId,
            positionAddress: position.positionAddress,
            poolName: position.poolName,
            oldRange: position.binRange,
            suggestedRange: {
              lower: currentBin - 5,
              upper: currentBin + 5,
            },
            telegramChatId: settings.telegram?.chatId,
          });
        }
      }
    }
  } else if (inRange && !wasInRange) {
    // Just came back in range
    await log('info', `Position ${position.positionAddress} is back IN RANGE`, {
      pool: position.poolName,
      currentBin,
    });
  }
  
  return { alertQueued };
}

// ============ Alert Processing ============

async function processAlertQueue(): Promise<void> {
  try {
    const alerts = await getReadyAlerts(10);
    
    if (alerts.length === 0) {
      return;
    }
    
    await log('info', `Processing ${alerts.length} queued alerts`);
    
    for (const alert of alerts) {
      await processAlert(alert);
    }
    
    await updateWorkerState({ lastAlertProcess: new Date().toISOString() });
    
  } catch (error: any) {
    await log('error', 'Alert processing failed', { error: error.message });
  }
}

async function processAlert(alert: QueuedAlert): Promise<void> {
  await markProcessing(alert);
  
  let delivered = false;
  let deliveryChannel = '';
  let lastError = '';
  
  // Try Telegram first
  if (alert.channels.includes('telegram') && alert.delivery.telegram) {
    try {
      const result = await deliverTelegramAlert(alert);
      if (result.success) {
        delivered = true;
        deliveryChannel = 'telegram';
      } else {
        lastError = result.error || 'Telegram delivery failed';
      }
    } catch (e: any) {
      lastError = e.message;
    }
  }
  
  // Try webhook as fallback
  if (!delivered && alert.channels.includes('webhook') && alert.delivery.webhook) {
    try {
      const result = await deliverWebhookAlert(alert);
      if (result.success) {
        delivered = true;
        deliveryChannel = 'webhook';
      } else {
        lastError = result.error || 'Webhook delivery failed';
      }
    } catch (e: any) {
      lastError = e.message;
    }
  }
  
  if (delivered) {
    await markDelivered(alert, deliveryChannel);
    const state = await getWorkerState();
    await updateWorkerState({ alertsDelivered: state.alertsDelivered + 1 });
  } else {
    await markRetry(alert, lastError);
  }
}

async function deliverTelegramAlert(alert: QueuedAlert): Promise<{ success: boolean; error?: string }> {
  const chatId = alert.delivery.telegram?.chatId;
  if (!chatId) {
    return { success: false, error: 'No chat ID' };
  }
  
  // Map alert type to appropriate Telegram function
  switch (alert.type) {
    case 'out_of_range':
      const oorResult = await sendOutOfRangeAlert({
        chatId,
        poolName: alert.payload.data?.poolName || 'Unknown',
        positionAddress: alert.payload.data?.positionAddress || '',
        currentBin: alert.payload.data?.currentBin || 0,
        binRange: alert.payload.data?.binRange || { lower: 0, upper: 0 },
        direction: alert.payload.data?.direction || 'above',
        distance: alert.payload.data?.distance || 0,
      });
      return { success: oorResult.success, error: oorResult.error };
    
    case 'rebalance_prompt':
      const rpResult = await sendRebalancePrompt({
        chatId,
        poolName: alert.payload.data?.poolName || 'Unknown',
        positionAddress: alert.payload.data?.positionAddress || '',
        currentRange: `${alert.payload.data?.oldRange?.lower || 0} - ${alert.payload.data?.oldRange?.upper || 0}`,
        suggestedRange: `${alert.payload.data?.suggestedRange?.lower || 0} - ${alert.payload.data?.suggestedRange?.upper || 0}`,
      });
      return { success: rpResult.success, error: rpResult.error };
    
    case 'daily_summary':
      const dsResult = await sendDailySummary({
        chatId,
        positions: alert.payload.data?.positions || [],
        totalValue: alert.payload.data?.totalValue,
        feesEarned: alert.payload.data?.feesEarned,
      });
      return { success: dsResult.success, error: dsResult.error };
    
    default:
      // Generic alert
      const result = await sendAlert({
        chatId,
        title: alert.payload.title,
        message: alert.payload.message,
        actions: alert.payload.actions,
        priority: alert.priority,
      });
      return { success: result.success, error: result.error };
  }
}

async function deliverWebhookAlert(alert: QueuedAlert): Promise<{ success: boolean; error?: string }> {
  const webhook = alert.delivery.webhook;
  if (!webhook?.url) {
    return { success: false, error: 'No webhook URL' };
  }
  
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: alert.type,
        userId: alert.userId,
        ...alert.payload,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

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
  await processAlertQueue();
  
  // Start intervals
  positionCheckTimer = setInterval(async () => {
    if (isRunning) {
      await checkAllPositions();
    }
  }, POSITION_CHECK_INTERVAL_MS);
  
  alertProcessTimer = setInterval(async () => {
    if (isRunning) {
      await processAlertQueue();
    }
  }, ALERT_PROCESS_INTERVAL_MS);
  
  await log('info', `Worker started. Position check: ${POSITION_CHECK_INTERVAL_MS / 1000}s, Alert process: ${ALERT_PROCESS_INTERVAL_MS / 1000}s`);
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
  
  if (alertProcessTimer) {
    clearInterval(alertProcessTimer);
    alertProcessTimer = null;
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

/**
 * Force immediate alert processing
 */
export async function triggerAlertProcessing(): Promise<void> {
  await log('info', 'Manual alert processing triggered');
  await processAlertQueue();
}

export default {
  startWorker,
  stopWorker,
  isWorkerRunning,
  getWorkerStatus,
  triggerPositionCheck,
  triggerAlertProcessing,
};
