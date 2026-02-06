/**
 * Alert Queue System
 * 
 * Queues alerts in Redis for reliable delivery with:
 * - Multiple delivery channels (Telegram, Webhook, etc.)
 * - Retry with exponential backoff
 * - Delivery tracking
 * - Dead letter queue for failed alerts
 */

import { Redis } from '@upstash/redis';

const KEYS = {
  QUEUE: 'lp-toolkit:alerts:queue',
  PROCESSING: 'lp-toolkit:alerts:processing',
  DELIVERED: 'lp-toolkit:alerts:delivered',
  FAILED: 'lp-toolkit:alerts:failed',
  STATS: 'lp-toolkit:alerts:stats',
};

export interface QueuedAlert {
  id: string;
  userId: string;
  type: 'out_of_range' | 'rebalance_prompt' | 'rebalance_complete' | 'price_alert' | 'daily_summary' | 'system';
  priority: 'high' | 'normal' | 'low';
  channels: ('telegram' | 'webhook' | 'email')[];
  payload: {
    title: string;
    message: string;
    data?: Record<string, any>;
    actions?: AlertAction[];
  };
  delivery: {
    telegram?: { chatId: number | string };
    webhook?: { url: string; secret?: string };
  };
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  deliveredAt?: string;
  deliveredVia?: string;
}

export interface AlertAction {
  label: string;
  action: string; // e.g., "rebalance", "dismiss", "snooze"
  data?: Record<string, any>;
}

export interface AlertStats {
  queued: number;
  processing: number;
  delivered: number;
  failed: number;
  lastProcessed?: string;
}

// Redis client
let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    throw new Error('Redis not configured for alert queue');
  }
  
  redis = new Redis({ url, token });
  return redis;
}

// ============ Queue Operations ============

/**
 * Add an alert to the queue
 */
export async function queueAlert(alert: Omit<QueuedAlert, 'id' | 'attempts' | 'nextAttemptAt' | 'createdAt'>): Promise<string> {
  const client = getRedis();
  
  const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  
  const fullAlert: QueuedAlert = {
    ...alert,
    id,
    attempts: 0,
    maxAttempts: alert.maxAttempts || 5,
    nextAttemptAt: now,
    createdAt: now,
  };
  
  // Add to queue (sorted set by next attempt time)
  await client.zadd(KEYS.QUEUE, {
    score: Date.now(),
    member: JSON.stringify(fullAlert),
  });
  
  console.log(`[AlertQueue] Queued alert ${id} for user ${alert.userId}: ${alert.payload.title}`);
  
  return id;
}

/**
 * Get alerts ready to be processed
 */
export async function getReadyAlerts(limit: number = 10): Promise<QueuedAlert[]> {
  const client = getRedis();
  
  const now = Date.now();
  
  // Get alerts with nextAttemptAt <= now
  // Upstash uses zrange with BYSCORE option
  const results = await client.zrange(KEYS.QUEUE, 0, now, { byScore: true, offset: 0, count: limit });
  
  return results.map((r: any) => {
    if (typeof r === 'string') {
      return JSON.parse(r) as QueuedAlert;
    }
    return r as unknown as QueuedAlert;
  });
}

/**
 * Move alert to processing state
 */
export async function markProcessing(alert: QueuedAlert): Promise<void> {
  const client = getRedis();
  
  // Remove from queue
  await client.zrem(KEYS.QUEUE, JSON.stringify(alert));
  
  // Add to processing set
  await client.hset(KEYS.PROCESSING, { [alert.id]: JSON.stringify(alert) });
}

/**
 * Mark alert as delivered
 */
export async function markDelivered(alert: QueuedAlert, channel: string): Promise<void> {
  const client = getRedis();
  
  alert.deliveredAt = new Date().toISOString();
  alert.deliveredVia = channel;
  
  // Remove from processing
  await client.hdel(KEYS.PROCESSING, alert.id);
  
  // Add to delivered (keep last 1000)
  await client.lpush(KEYS.DELIVERED, JSON.stringify(alert));
  await client.ltrim(KEYS.DELIVERED, 0, 999);
  
  // Update stats
  await client.hincrby(KEYS.STATS, 'delivered', 1);
  
  console.log(`[AlertQueue] ✅ Delivered alert ${alert.id} via ${channel}`);
}

/**
 * Mark alert for retry
 */
export async function markRetry(alert: QueuedAlert, error: string): Promise<void> {
  const client = getRedis();
  
  alert.attempts++;
  alert.lastAttemptAt = new Date().toISOString();
  alert.lastError = error;
  
  if (alert.attempts >= alert.maxAttempts) {
    // Move to failed queue
    await client.hdel(KEYS.PROCESSING, alert.id);
    await client.lpush(KEYS.FAILED, JSON.stringify(alert));
    await client.ltrim(KEYS.FAILED, 0, 999);
    await client.hincrby(KEYS.STATS, 'failed', 1);
    
    console.log(`[AlertQueue] ❌ Alert ${alert.id} failed after ${alert.attempts} attempts: ${error}`);
  } else {
    // Calculate next attempt with exponential backoff
    const backoffMs = Math.pow(2, alert.attempts) * 1000; // 2s, 4s, 8s, 16s, 32s
    alert.nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
    
    // Remove from processing, add back to queue
    await client.hdel(KEYS.PROCESSING, alert.id);
    await client.zadd(KEYS.QUEUE, {
      score: Date.now() + backoffMs,
      member: JSON.stringify(alert),
    });
    
    console.log(`[AlertQueue] ⏳ Alert ${alert.id} retry ${alert.attempts}/${alert.maxAttempts} in ${backoffMs}ms`);
  }
}

/**
 * Get queue statistics
 */
export async function getStats(): Promise<AlertStats> {
  const client = getRedis();
  
  const [queueSize, processingSize, stats] = await Promise.all([
    client.zcard(KEYS.QUEUE),
    client.hlen(KEYS.PROCESSING),
    client.hgetall(KEYS.STATS),
  ]);
  
  return {
    queued: queueSize,
    processing: processingSize,
    delivered: parseInt(stats?.delivered as string || '0'),
    failed: parseInt(stats?.failed as string || '0'),
    lastProcessed: stats?.lastProcessed as string,
  };
}

/**
 * Get failed alerts (for debugging/retry)
 */
export async function getFailedAlerts(limit: number = 50): Promise<QueuedAlert[]> {
  const client = getRedis();
  
  const results = await client.lrange(KEYS.FAILED, 0, limit - 1);
  
  return results.map(r => {
    if (typeof r === 'string') {
      return JSON.parse(r) as QueuedAlert;
    }
    return r as unknown as QueuedAlert;
  });
}

/**
 * Retry a failed alert
 */
export async function retryFailedAlert(alertId: string): Promise<boolean> {
  const client = getRedis();
  
  const failed = await getFailedAlerts(100);
  const alert = failed.find(a => a.id === alertId);
  
  if (!alert) return false;
  
  // Reset and requeue
  alert.attempts = 0;
  alert.nextAttemptAt = new Date().toISOString();
  delete alert.lastError;
  delete alert.deliveredAt;
  
  await client.zadd(KEYS.QUEUE, {
    score: Date.now(),
    member: JSON.stringify(alert),
  });
  
  console.log(`[AlertQueue] Retrying failed alert ${alertId}`);
  return true;
}

// ============ Convenience Functions ============

/**
 * Queue an out-of-range alert
 */
export async function queueOutOfRangeAlert(params: {
  userId: string;
  positionAddress: string;
  poolName: string;
  currentBin: number;
  binRange: { lower: number; upper: number };
  telegramChatId?: number | string;
  webhookUrl?: string;
}): Promise<string> {
  const direction = params.currentBin < params.binRange.lower ? 'below' : 'above';
  const distance = params.currentBin < params.binRange.lower 
    ? params.binRange.lower - params.currentBin
    : params.currentBin - params.binRange.upper;
  
  const channels: ('telegram' | 'webhook')[] = [];
  const delivery: QueuedAlert['delivery'] = {};
  
  if (params.telegramChatId) {
    channels.push('telegram');
    delivery.telegram = { chatId: params.telegramChatId };
  }
  if (params.webhookUrl) {
    channels.push('webhook');
    delivery.webhook = { url: params.webhookUrl };
  }
  
  return queueAlert({
    userId: params.userId,
    type: 'out_of_range',
    priority: 'high',
    channels,
    payload: {
      title: `🚨 ${params.poolName} Out of Range`,
      message: `Your position is ${distance} bins ${direction} your range.\n\nCurrent: bin ${params.currentBin}\nYour range: ${params.binRange.lower} - ${params.binRange.upper}`,
      data: {
        positionAddress: params.positionAddress,
        poolName: params.poolName,
        currentBin: params.currentBin,
        binRange: params.binRange,
        direction,
        distance,
      },
      actions: [
        { label: '🔄 Rebalance', action: 'rebalance', data: { positionAddress: params.positionAddress } },
        { label: '⏰ Snooze 1h', action: 'snooze', data: { hours: 1 } },
        { label: '✓ Dismiss', action: 'dismiss' },
      ],
    },
    delivery,
    maxAttempts: 5,
  });
}

/**
 * Queue a rebalance prompt
 */
export async function queueRebalancePrompt(params: {
  userId: string;
  positionAddress: string;
  poolName: string;
  oldRange: { lower: number; upper: number };
  suggestedRange: { lower: number; upper: number };
  telegramChatId?: number | string;
}): Promise<string> {
  const channels: ('telegram')[] = [];
  const delivery: QueuedAlert['delivery'] = {};
  
  if (params.telegramChatId) {
    channels.push('telegram');
    delivery.telegram = { chatId: params.telegramChatId };
  }
  
  return queueAlert({
    userId: params.userId,
    type: 'rebalance_prompt',
    priority: 'high',
    channels,
    payload: {
      title: `🔄 Rebalance ${params.poolName}?`,
      message: `Your position has been out of range. Want me to rebalance?\n\nCurrent range: ${params.oldRange.lower} - ${params.oldRange.upper}\nSuggested range: ${params.suggestedRange.lower} - ${params.suggestedRange.upper}`,
      data: {
        positionAddress: params.positionAddress,
        poolName: params.poolName,
        oldRange: params.oldRange,
        suggestedRange: params.suggestedRange,
      },
      actions: [
        { label: '✅ Yes, rebalance', action: 'rebalance', data: { positionAddress: params.positionAddress } },
        { label: '❌ No', action: 'dismiss' },
        { label: '⚙️ Change range', action: 'custom_range' },
      ],
    },
    delivery,
    maxAttempts: 3,
  });
}

/**
 * Queue a daily summary
 */
export async function queueDailySummary(params: {
  userId: string;
  summary: {
    totalPositions: number;
    inRange: number;
    outOfRange: number;
    totalValueUsd?: number;
    feesEarnedUsd?: number;
  };
  telegramChatId?: number | string;
}): Promise<string> {
  const channels: ('telegram')[] = [];
  const delivery: QueuedAlert['delivery'] = {};
  
  if (params.telegramChatId) {
    channels.push('telegram');
    delivery.telegram = { chatId: params.telegramChatId };
  }
  
  const statusEmoji = params.summary.outOfRange > 0 ? '⚠️' : '✅';
  
  return queueAlert({
    userId: params.userId,
    type: 'daily_summary',
    priority: 'low',
    channels,
    payload: {
      title: `${statusEmoji} Daily LP Summary`,
      message: [
        `📊 **Portfolio Status**`,
        `• Positions: ${params.summary.totalPositions}`,
        `• In range: ${params.summary.inRange} ✅`,
        `• Out of range: ${params.summary.outOfRange} ${params.summary.outOfRange > 0 ? '⚠️' : ''}`,
        params.summary.totalValueUsd ? `• Total value: $${params.summary.totalValueUsd.toFixed(2)}` : '',
        params.summary.feesEarnedUsd ? `• Fees earned: $${params.summary.feesEarnedUsd.toFixed(2)}` : '',
      ].filter(Boolean).join('\n'),
      data: params.summary,
    },
    delivery,
    maxAttempts: 3,
  });
}

export default {
  queueAlert,
  getReadyAlerts,
  markProcessing,
  markDelivered,
  markRetry,
  getStats,
  getFailedAlerts,
  retryFailedAlert,
  queueOutOfRangeAlert,
  queueRebalancePrompt,
  queueDailySummary,
};
