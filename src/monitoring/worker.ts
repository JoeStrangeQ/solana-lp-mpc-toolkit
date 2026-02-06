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
  WITHDRAWAL_QUEUE: 'lp-toolkit:withdrawal:queue',
  WITHDRAWAL_PROCESSING: 'lp-toolkit:withdrawal:processing',
  SWAP_QUEUE: 'lp-toolkit:swap:queue',
  SWAP_PROCESSING: 'lp-toolkit:swap:processing',
};

// ============ Withdrawal Job Types ============

export interface WithdrawalJob {
  id: string;
  walletId: string;
  poolAddress: string;
  positionAddress: string;
  chatId: number | string;
  convertToSol: boolean;
  queuedAt: string;
  poolName?: string;
}

export interface SwapJob {
  id: string;
  walletId: string;
  chatId: number | string;
  queuedAt: string;
}

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

// ============ Withdrawal Queue ============

const WITHDRAWAL_CHECK_INTERVAL_MS = 5 * 1000; // Check every 5 seconds
let withdrawalQueueTimer: NodeJS.Timeout | null = null;
let swapQueueTimer: NodeJS.Timeout | null = null;

/**
 * Queue a withdrawal job for background processing
 */
export async function queueWithdrawal(job: Omit<WithdrawalJob, 'id' | 'queuedAt'>): Promise<string> {
  const client = getRedis();
  if (!client) throw new Error('Redis not available');
  
  const id = `wd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullJob: WithdrawalJob = {
    ...job,
    id,
    queuedAt: new Date().toISOString(),
  };
  
  await client.lpush(KEYS.WITHDRAWAL_QUEUE, JSON.stringify(fullJob));
  await log('info', `Queued withdrawal ${id}`, { poolAddress: job.poolAddress, chatId: job.chatId });
  
  return id;
}

/**
 * Process one withdrawal job from the queue
 */
async function processWithdrawalQueue(): Promise<void> {
  const client = getRedis();
  if (!client) return;
  
  // Check if already processing (prevent concurrent processing)
  const processing = await client.get(KEYS.WITHDRAWAL_PROCESSING);
  if (processing) {
    return; // Another job is in progress
  }
  
  // Get next job
  const rawJob = await client.rpop(KEYS.WITHDRAWAL_QUEUE);
  if (!rawJob) return;
  
  const job: WithdrawalJob = typeof rawJob === 'string' ? JSON.parse(rawJob) : rawJob;
  
  // Mark as processing (with 5 min timeout to prevent stuck jobs)
  await client.set(KEYS.WITHDRAWAL_PROCESSING, job.id, { ex: 300 });
  
  await log('info', `Processing withdrawal ${job.id}`, { 
    poolAddress: job.poolAddress, 
    positionAddress: job.positionAddress 
  });
  
  try {
    // Execute withdrawal via API
    const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:3000';
    
    const response = await fetch(`${apiUrl}/lp/withdraw/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletId: job.walletId,
        poolAddress: job.poolAddress,
        positionAddress: job.positionAddress,
        convertToSol: job.convertToSol,
      }),
    });
    
    const result = await response.json() as any;
    
    // Send result to Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken && job.chatId) {
      let message: string;
      
      if (result.success) {
        const poolName = job.poolName || job.poolAddress.slice(0, 8) + '...';
        message = [
          `✅ *Withdrawal Complete!*`,
          ``,
          `📊 Pool: ${poolName}`,
          `📤 Position closed`,
          result.bundle?.bundleId ? `📍 Bundle: \`${result.bundle.bundleId.slice(0, 16)}...\`` : '',
          ``,
          `_Use /balance to see updated balance_`,
        ].filter(Boolean).join('\n');
        
        await log('info', `Withdrawal ${job.id} successful`, { bundleId: result.bundle?.bundleId });
        
        // CACHE FIX: Invalidate position caches after successful withdrawal
        try {
          await client.del(`positions:${job.walletId}`); // Clear position map cache
          await log('info', `Invalidated position cache for wallet ${job.walletId}`);
        } catch (e) {
          await log('warn', 'Failed to invalidate position cache', { error: (e as Error).message });
        }
      } else {
        message = [
          `❌ *Withdrawal Failed*`,
          ``,
          `Pool: ${job.poolName || job.poolAddress.slice(0, 8)}...`,
          `Error: ${result.error || 'Unknown error'}`,
          ``,
          `_Click the withdraw button again to retry_`,
        ].join('\n');
        
        await log('error', `Withdrawal ${job.id} failed`, { error: result.error });
      }
      
      // Send via Telegram Bot API
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: job.chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });
    }
    
  } catch (error: any) {
    await log('error', `Withdrawal ${job.id} threw error`, { error: error.message });
    
    // Notify user of error
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken && job.chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: job.chatId,
          text: `❌ *Withdrawal Error*\n\nFailed to process withdrawal. Please try again.\n\nError: ${error.message}`,
          parse_mode: 'Markdown',
        }),
      });
    }
  } finally {
    // Clear processing lock
    await client.del(KEYS.WITHDRAWAL_PROCESSING);
  }
}

/**
 * Get pending withdrawal count
 */
export async function getWithdrawalQueueLength(): Promise<number> {
  const client = getRedis();
  if (!client) return 0;
  return await client.llen(KEYS.WITHDRAWAL_QUEUE);
}

// ============ Swap Queue ============

/**
 * Queue a swap-all-to-SOL job for background processing
 */
export async function queueSwapAll(job: Omit<SwapJob, 'id' | 'queuedAt'>): Promise<string> {
  const client = getRedis();
  if (!client) throw new Error('Redis not available');
  
  const id = `swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullJob: SwapJob = {
    ...job,
    id,
    queuedAt: new Date().toISOString(),
  };
  
  await client.lpush(KEYS.SWAP_QUEUE, JSON.stringify(fullJob));
  await log('info', `Queued swap-all ${id}`, { walletId: job.walletId, chatId: job.chatId });
  
  return id;
}

/**
 * Process one swap job from the queue
 */
async function processSwapQueue(): Promise<void> {
  const client = getRedis();
  if (!client) return;
  
  // Check if already processing
  const processing = await client.get(KEYS.SWAP_PROCESSING);
  if (processing) return;
  
  // Get next job
  const rawJob = await client.rpop(KEYS.SWAP_QUEUE);
  if (!rawJob) return;
  
  const job: SwapJob = typeof rawJob === 'string' ? JSON.parse(rawJob) : rawJob;
  
  // Mark as processing (5 min timeout)
  await client.set(KEYS.SWAP_PROCESSING, job.id, { ex: 300 });
  
  await log('info', `Processing swap-all ${job.id}`, { walletId: job.walletId });
  
  try {
    // Call the swap endpoint
    const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:3000';
    
    const response = await fetch(`${apiUrl}/wallet/${job.walletId}/swap-all-to-sol`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    const result = await response.json() as any;
    
    // Send result to Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken && job.chatId) {
      let message: string;
      
      if (result.success) {
        const swaps = result.swaps || [];
        const swapLines = swaps.map((s: any) => `  • ${s.from} → ${s.to}: ${s.amount}`).join('\n');
        
        message = [
          `✅ *Swap Complete!*`,
          ``,
          `🔄 Swapped ${swaps.length} token(s) to SOL`,
          swapLines || '  _No tokens needed swapping_',
          ``,
          result.bundleId ? `📍 Bundle: \`${result.bundleId.slice(0, 16)}...\`` : '',
          ``,
          `_Use /balance to see updated balance_`,
        ].filter(Boolean).join('\n');
        
        await log('info', `Swap ${job.id} successful`, { bundleId: result.bundleId });
      } else {
        message = [
          `❌ *Swap Failed*`,
          ``,
          `Error: ${result.error || 'Unknown error'}`,
          ``,
          `_Please try again later_`,
        ].join('\n');
        
        await log('error', `Swap ${job.id} failed`, { error: result.error });
      }
      
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: job.chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });
    }
    
  } catch (error: any) {
    await log('error', `Swap ${job.id} threw error`, { error: error.message });
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken && job.chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: job.chatId,
          text: `❌ *Swap Error*\n\nFailed to swap tokens. Please try again.\n\nError: ${error.message}`,
          parse_mode: 'Markdown',
        }),
      });
    }
  } finally {
    await client.del(KEYS.SWAP_PROCESSING);
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
  
  // Start position check interval
  positionCheckTimer = setInterval(async () => {
    if (isRunning) {
      await checkAllPositions();
    }
  }, POSITION_CHECK_INTERVAL_MS);
  
  // Start withdrawal queue processing
  withdrawalQueueTimer = setInterval(async () => {
    if (isRunning) {
      await processWithdrawalQueue();
    }
  }, WITHDRAWAL_CHECK_INTERVAL_MS);
  
  // Start swap queue processing
  swapQueueTimer = setInterval(async () => {
    if (isRunning) {
      await processSwapQueue();
    }
  }, WITHDRAWAL_CHECK_INTERVAL_MS);
  
  await log('info', `Worker started. Position check: ${POSITION_CHECK_INTERVAL_MS / 1000}s, Queue processing: ${WITHDRAWAL_CHECK_INTERVAL_MS / 1000}s`);
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
  
  if (withdrawalQueueTimer) {
    clearInterval(withdrawalQueueTimer);
    withdrawalQueueTimer = null;
  }
  
  if (swapQueueTimer) {
    clearInterval(swapQueueTimer);
    swapQueueTimer = null;
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
