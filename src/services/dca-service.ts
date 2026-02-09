/**
 * DCA (Dollar Cost Averaging) Service
 * 
 * Enables users to set up recurring LP deposits into a pool.
 * Schedules are stored in Redis and executed by the monitoring worker.
 */

import { Redis } from '@upstash/redis';
import { executeLp, type LpExecuteParams } from './lp-service.js';
import { executeOrcaLp, type OrcaLpExecuteParams } from './orca-service.js';
import { executeRaydiumLp, type RaydiumLpExecuteParams } from './raydium-service.js';
import { loadWalletById } from './wallet-service.js';

// Redis keys
const KEYS = {
  DCA_SCHEDULES: 'lp-toolkit:dca:schedules',
  DCA_HISTORY: 'lp-toolkit:dca:history',
  DCA_ACTIVE: 'lp-toolkit:dca:active',
};

// Interval options
export type DCAInterval = '1h' | '4h' | '12h' | '24h' | '7d';

const INTERVAL_MS: Record<DCAInterval, number> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export interface DCASchedule {
  id: string;
  walletId: string;
  walletAddress: string;
  chatId: number;
  
  // Pool config
  poolAddress: string;
  poolName: string;
  dex: 'meteora' | 'orca' | 'raydium';
  
  // Amount config
  amountSolPerExecution: number;
  totalBudgetSol: number;
  spentSol: number;
  
  // Timing
  interval: DCAInterval;
  nextExecutionAt: number; // timestamp ms
  executionCount: number;
  maxExecutions: number; // 0 = unlimited until budget depleted
  
  // Strategy
  strategy: 'tight' | 'balanced' | 'wide';
  
  // State
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  createdAt: number;
  lastExecutedAt?: number;
  lastError?: string;
}

export interface DCAExecution {
  scheduleId: string;
  executedAt: number;
  amountSol: number;
  success: boolean;
  txHash?: string;
  bundleId?: string;
  error?: string;
}

// Initialize Redis
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured for DCA service (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)');
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Send a simple notification to the user via Telegram
 */
async function sendDCANotification(chatId: number, message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[DCA] Bot token not configured, skipping notification');
    return;
  }
  
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (error) {
    console.error('[DCA] Failed to send notification:', error);
  }
}

/**
 * Create a new DCA schedule
 */
export async function createDCASchedule(params: {
  walletId: string;
  walletAddress: string;
  chatId: number;
  poolAddress: string;
  poolName: string;
  dex: 'meteora' | 'orca' | 'raydium';
  amountPerExecution: number;
  totalBudget: number;
  interval: DCAInterval;
  strategy?: 'tight' | 'balanced' | 'wide';
}): Promise<DCASchedule> {
  const redis = getRedis();
  
  const id = `dca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const intervalMs = INTERVAL_MS[params.interval];
  const maxExecutions = Math.floor(params.totalBudget / params.amountPerExecution);
  
  const schedule: DCASchedule = {
    id,
    walletId: params.walletId,
    walletAddress: params.walletAddress,
    chatId: params.chatId,
    poolAddress: params.poolAddress,
    poolName: params.poolName,
    dex: params.dex,
    amountSolPerExecution: params.amountPerExecution,
    totalBudgetSol: params.totalBudget,
    spentSol: 0,
    interval: params.interval,
    nextExecutionAt: Date.now() + intervalMs, // First execution after one interval
    executionCount: 0,
    maxExecutions,
    strategy: params.strategy || 'balanced',
    status: 'active',
    createdAt: Date.now(),
  };
  
  // Store in Redis
  await redis.hset(KEYS.DCA_SCHEDULES, { [id]: JSON.stringify(schedule) });
  await redis.sadd(KEYS.DCA_ACTIVE, id);
  
  console.log(`[DCA] Created schedule ${id} for ${params.poolName}, ${params.amountPerExecution} SOL every ${params.interval}`);
  
  return schedule;
}

/**
 * Get all active DCA schedules
 */
export async function getActiveDCASchedules(): Promise<DCASchedule[]> {
  const redis = getRedis();
  
  const activeIds = await redis.smembers(KEYS.DCA_ACTIVE);
  if (!activeIds || activeIds.length === 0) return [];
  
  const schedules: DCASchedule[] = [];
  
  for (const id of activeIds) {
    const data = await redis.hget(KEYS.DCA_SCHEDULES, id as string);
    if (data) {
      schedules.push(JSON.parse(data as string));
    }
  }
  
  return schedules;
}

/**
 * Get DCA schedules for a specific user
 */
export async function getUserDCASchedules(walletId: string): Promise<DCASchedule[]> {
  const all = await getActiveDCASchedules();
  return all.filter(s => s.walletId === walletId);
}

/**
 * Get a specific DCA schedule
 */
export async function getDCASchedule(id: string): Promise<DCASchedule | null> {
  const redis = getRedis();
  const data = await redis.hget(KEYS.DCA_SCHEDULES, id);
  return data ? JSON.parse(data as string) : null;
}

/**
 * Update DCA schedule
 */
export async function updateDCASchedule(schedule: DCASchedule): Promise<void> {
  const redis = getRedis();
  await redis.hset(KEYS.DCA_SCHEDULES, { [schedule.id]: JSON.stringify(schedule) });
  
  // Update active set based on status
  if (schedule.status === 'active') {
    await redis.sadd(KEYS.DCA_ACTIVE, schedule.id);
  } else {
    await redis.srem(KEYS.DCA_ACTIVE, schedule.id);
  }
}

/**
 * Cancel a DCA schedule
 */
export async function cancelDCASchedule(id: string): Promise<boolean> {
  const schedule = await getDCASchedule(id);
  if (!schedule) return false;
  
  schedule.status = 'cancelled';
  await updateDCASchedule(schedule);
  
  console.log(`[DCA] Cancelled schedule ${id}`);
  return true;
}

/**
 * Pause a DCA schedule
 */
export async function pauseDCASchedule(id: string): Promise<boolean> {
  const schedule = await getDCASchedule(id);
  if (!schedule || schedule.status !== 'active') return false;
  
  schedule.status = 'paused';
  await updateDCASchedule(schedule);
  
  console.log(`[DCA] Paused schedule ${id}`);
  return true;
}

/**
 * Resume a paused DCA schedule
 */
export async function resumeDCASchedule(id: string): Promise<boolean> {
  const schedule = await getDCASchedule(id);
  if (!schedule || schedule.status !== 'paused') return false;
  
  schedule.status = 'active';
  schedule.nextExecutionAt = Date.now() + INTERVAL_MS[schedule.interval];
  await updateDCASchedule(schedule);
  
  console.log(`[DCA] Resumed schedule ${id}`);
  return true;
}

/**
 * Execute a single DCA deposit
 */
export async function executeDCADeposit(schedule: DCASchedule): Promise<DCAExecution> {
  const execution: DCAExecution = {
    scheduleId: schedule.id,
    executedAt: Date.now(),
    amountSol: schedule.amountSolPerExecution,
    success: false,
  };
  
  try {
    console.log(`[DCA] Executing deposit for ${schedule.id}: ${schedule.amountSolPerExecution} SOL into ${schedule.poolName}`);
    
    // Load wallet
    const { client } = await loadWalletById(schedule.walletId);
    
    let result: { bundleId?: string; txHashes?: string[] };
    
    // Execute based on DEX
    if (schedule.dex === 'orca') {
      const params: OrcaLpExecuteParams = {
        walletId: schedule.walletId,
        walletAddress: schedule.walletAddress,
        poolAddress: schedule.poolAddress,
        amountSol: schedule.amountSolPerExecution,
        strategy: schedule.strategy === 'tight' ? 'concentrated' : 'wide',
        tipSpeed: 'fast',
        slippageBps: 300,
        signTransaction: async (tx) => client.signTransaction(tx),
      };
      result = await executeOrcaLp(params);
    } else if (schedule.dex === 'raydium') {
      const params: RaydiumLpExecuteParams = {
        walletId: schedule.walletId,
        walletAddress: schedule.walletAddress,
        poolAddress: schedule.poolAddress,
        amountSol: schedule.amountSolPerExecution,
        strategy: schedule.strategy,
        tipSpeed: 'fast',
        slippageBps: 300,
        signTransaction: async (tx) => client.signTransaction(tx),
      };
      result = await executeRaydiumLp(params);
    } else {
      // Meteora
      const params: LpExecuteParams = {
        walletId: schedule.walletId,
        walletAddress: schedule.walletAddress,
        poolAddress: schedule.poolAddress,
        amountSol: schedule.amountSolPerExecution,
        minBinId: schedule.strategy === 'tight' ? -3 : schedule.strategy === 'wide' ? -25 : -8,
        maxBinId: schedule.strategy === 'tight' ? 3 : schedule.strategy === 'wide' ? 25 : 8,
        strategy: schedule.strategy === 'wide' ? 'wide' : 'concentrated',
        shape: 'spot',
        tipSpeed: 'fast',
        slippageBps: 300,
        signTransaction: async (tx) => client.signTransaction(tx),
      };
      result = await executeLp(params);
    }
    
    execution.success = true;
    execution.bundleId = result.bundleId;
    execution.txHash = result.txHashes?.[0];
    
    // Update schedule
    schedule.executionCount++;
    schedule.spentSol += schedule.amountSolPerExecution;
    schedule.lastExecutedAt = Date.now();
    schedule.nextExecutionAt = Date.now() + INTERVAL_MS[schedule.interval];
    
    // Check if complete
    if (schedule.spentSol >= schedule.totalBudgetSol || 
        (schedule.maxExecutions > 0 && schedule.executionCount >= schedule.maxExecutions)) {
      schedule.status = 'completed';
      console.log(`[DCA] Schedule ${schedule.id} completed after ${schedule.executionCount} executions`);
    }
    
    await updateDCASchedule(schedule);
    
    // Send success notification
    await sendDCANotification(
      schedule.chatId,
      `*✅ DCA Executed*\n\n` +
      `Added ${schedule.amountSolPerExecution} SOL to ${schedule.poolName}\n\n` +
      `Progress: ${schedule.executionCount}/${schedule.maxExecutions} (${((schedule.spentSol / schedule.totalBudgetSol) * 100).toFixed(0)}%)`
    );
    
  } catch (error: any) {
    console.error(`[DCA] Execution failed for ${schedule.id}:`, error);
    
    execution.error = error.message || 'Unknown error';
    
    // Update schedule with error
    schedule.lastError = execution.error;
    schedule.nextExecutionAt = Date.now() + INTERVAL_MS[schedule.interval]; // Try again next interval
    await updateDCASchedule(schedule);
    
    // Send failure notification
    await sendDCANotification(
      schedule.chatId,
      `*❌ DCA Failed*\n\n` +
      `Failed to add liquidity to ${schedule.poolName}\n\n` +
      `Error: ${execution.error}\n\n` +
      `Will retry at next interval.`
    );
  }
  
  // Log execution
  const redis = getRedis();
  await redis.lpush(`${KEYS.DCA_HISTORY}:${schedule.id}`, JSON.stringify(execution));
  await redis.ltrim(`${KEYS.DCA_HISTORY}:${schedule.id}`, 0, 99); // Keep last 100
  
  return execution;
}

/**
 * Process all due DCA schedules (called by worker)
 */
export async function processDueSchedules(): Promise<number> {
  const schedules = await getActiveDCASchedules();
  const now = Date.now();
  let processed = 0;
  
  for (const schedule of schedules) {
    if (schedule.status === 'active' && schedule.nextExecutionAt <= now) {
      await executeDCADeposit(schedule);
      processed++;
    }
  }
  
  return processed;
}

/**
 * Get DCA execution history
 */
export async function getDCAHistory(scheduleId: string, limit: number = 10): Promise<DCAExecution[]> {
  const redis = getRedis();
  const history = await redis.lrange(`${KEYS.DCA_HISTORY}:${scheduleId}`, 0, limit - 1);
  return history.map(h => JSON.parse(h as string));
}

/**
 * Format interval for display
 */
export function formatInterval(interval: DCAInterval): string {
  const labels: Record<DCAInterval, string> = {
    '1h': 'Hourly',
    '4h': 'Every 4 hours',
    '12h': 'Twice daily',
    '24h': 'Daily',
    '7d': 'Weekly',
  };
  return labels[interval];
}

/**
 * Format next execution time
 */
export function formatNextExecution(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'Now';
  
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
