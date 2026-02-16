/**
 * Redis Persistence Module (Upstash)
 * 
 * Redis-based storage for monitored positions and webhook config.
 * Falls back to in-memory if Redis not configured.
 * 
 * Environment variables:
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 */

import { Redis } from '@upstash/redis';
import type { MonitoredPosition } from './positionMonitor.js';
import type { WebhookConfig } from './webhookDelivery.js';

export interface PersistedData {
  version: number;
  lastUpdated: string;
  positions: MonitoredPosition[];
  webhook: WebhookConfig | null;
  lastCheck?: string;
}

// Redis keys
const KEYS = {
  POSITIONS: 'lp-toolkit:positions',
  WEBHOOK: 'lp-toolkit:webhook',
  LAST_CHECK: 'lp-toolkit:lastCheck',
  VERSION: 'lp-toolkit:version',
};

const CURRENT_VERSION = 1;

// In-memory fallback
let memoryStore: PersistedData = {
  version: CURRENT_VERSION,
  lastUpdated: new Date().toISOString(),
  positions: [],
  webhook: null,
};

// Redis client (lazy init)
let redis: Redis | null = null;
let redisAvailable = false;

/**
 * Initialize Redis connection
 */
function initRedis(): Redis | null {
  if (redis !== null) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.warn('[Redis] ⚠️ UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set');
    console.warn('[Redis] ⚠️ Falling back to in-memory storage (data will not persist across restarts)');
    redisAvailable = false;
    return null;
  }
  
  try {
    const client = new Redis({ url, token });
    // Ping to verify connectivity (catches over-limit errors early)
    client.ping().then(() => {
      redisAvailable = true;
      console.log('[Redis] ✅ Connected to Upstash Redis');
    }).catch((err: any) => {
      console.warn(`[Redis] ⚠️ Redis ping failed (falling back to in-memory): ${err.message}`);
      redisAvailable = false;
      redis = null;
    });
    redis = client;
    redisAvailable = true; // Optimistic; ping will correct if needed
    return redis;
  } catch (error: any) {
    console.error(`[Redis] ❌ Failed to connect: ${error.message}`);
    redisAvailable = false;
    return null;
  }
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  initRedis();
  return redisAvailable;
}

/**
 * Load persisted data from Redis
 */
export async function loadData(): Promise<PersistedData> {
  const client = initRedis();
  
  if (!client) {
    console.log('[Persistence] Using in-memory storage');
    return memoryStore;
  }
  
  try {
    // Load all data from Redis
    const [positions, webhook, lastCheck, version] = await Promise.all([
      client.get<MonitoredPosition[]>(KEYS.POSITIONS),
      client.get<WebhookConfig>(KEYS.WEBHOOK),
      client.get<string>(KEYS.LAST_CHECK),
      client.get<number>(KEYS.VERSION),
    ]);
    
    const data: PersistedData = {
      version: version || CURRENT_VERSION,
      lastUpdated: new Date().toISOString(),
      positions: positions || [],
      webhook: webhook || null,
      lastCheck: lastCheck || undefined,
    };
    
    console.log(`[Persistence] Loaded ${data.positions.length} positions from Redis, webhook: ${data.webhook ? 'configured' : 'none'}`);
    return data;
  } catch (error: any) {
    console.error(`[Persistence] Failed to load from Redis: ${error.message}`);
    return memoryStore;
  }
}

/**
 * Load data synchronously (for compatibility - initiates async load)
 * Note: First call returns empty/cached, subsequent calls return loaded data
 */
let cachedData: PersistedData | null = null;
let loadPromise: Promise<PersistedData> | null = null;

export function loadDataSync(): PersistedData {
  // Trigger async load if not started
  if (!loadPromise) {
    loadPromise = loadData().then(data => {
      cachedData = data;
      return data;
    });
  }
  
  // Return cached or default
  return cachedData || {
    version: CURRENT_VERSION,
    lastUpdated: new Date().toISOString(),
    positions: [],
    webhook: null,
  };
}

/**
 * Save data to Redis
 */
export async function saveData(data: PersistedData): Promise<void> {
  const client = initRedis();
  
  data.lastUpdated = new Date().toISOString();
  
  if (!client) {
    memoryStore = data;
    console.log(`[Persistence] Saved ${data.positions.length} positions to memory`);
    return;
  }
  
  try {
    await Promise.all([
      client.set(KEYS.POSITIONS, data.positions),
      client.set(KEYS.WEBHOOK, data.webhook),
      data.lastCheck ? client.set(KEYS.LAST_CHECK, data.lastCheck) : Promise.resolve(),
      client.set(KEYS.VERSION, data.version),
    ]);
    
    cachedData = data;
    console.log(`[Persistence] Saved ${data.positions.length} positions to Redis`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to save to Redis: ${error.message}`);
    // Fallback to memory
    memoryStore = data;
    throw error;
  }
}

/**
 * Add a position to persistent storage
 */
export async function addPosition(position: MonitoredPosition): Promise<PersistedData> {
  const data = await loadData();
  
  // Check if position already exists
  const existingIndex = data.positions.findIndex(p => p.positionAddress === position.positionAddress);
  
  if (existingIndex >= 0) {
    // Update existing
    data.positions[existingIndex] = position;
    console.log(`[Persistence] Updated position ${position.positionAddress}`);
  } else {
    // Add new
    data.positions.push(position);
    console.log(`[Persistence] Added position ${position.positionAddress}`);
  }
  
  await saveData(data);
  return data;
}

/**
 * Remove a position from persistent storage
 */
export async function removePosition(positionAddress: string): Promise<PersistedData> {
  const data = await loadData();
  
  const initialLength = data.positions.length;
  data.positions = data.positions.filter(p => p.positionAddress !== positionAddress);
  
  if (data.positions.length < initialLength) {
    console.log(`[Persistence] Removed position ${positionAddress}`);
    await saveData(data);
  } else {
    console.log(`[Persistence] Position ${positionAddress} not found`);
  }
  
  return data;
}

/**
 * Get all positions from persistent storage
 */
export async function getPositions(): Promise<MonitoredPosition[]> {
  const data = await loadData();
  return data.positions;
}

/**
 * Update webhook configuration
 */
export async function setWebhook(webhook: WebhookConfig | null): Promise<PersistedData> {
  const data = await loadData();
  data.webhook = webhook;
  await saveData(data);
  console.log(`[Persistence] Webhook ${webhook ? 'configured' : 'removed'}`);
  return data;
}

/**
 * Get webhook configuration
 */
export async function getWebhook(): Promise<WebhookConfig | null> {
  const data = await loadData();
  return data.webhook;
}

/**
 * Update last check timestamp
 */
export async function setLastCheck(timestamp: string): Promise<void> {
  const client = initRedis();
  
  if (!client) {
    memoryStore.lastCheck = timestamp;
    return;
  }
  
  try {
    await client.set(KEYS.LAST_CHECK, timestamp);
  } catch (error: any) {
    console.error(`[Persistence] Failed to set lastCheck: ${error.message}`);
    memoryStore.lastCheck = timestamp;
  }
}

/**
 * Get last check timestamp
 */
export async function getLastCheck(): Promise<string | undefined> {
  const client = initRedis();
  
  if (!client) {
    return memoryStore.lastCheck;
  }
  
  try {
    const lastCheck = await client.get<string>(KEYS.LAST_CHECK);
    return lastCheck || undefined;
  } catch (error: any) {
    console.error(`[Persistence] Failed to get lastCheck: ${error.message}`);
    return memoryStore.lastCheck;
  }
}

/**
 * Get storage info (for debugging)
 */
export function getStorageInfo(): { type: 'redis' | 'memory'; available: boolean } {
  initRedis();
  return {
    type: redisAvailable ? 'redis' : 'memory',
    available: redisAvailable,
  };
}

/**
 * Clear all data (for testing)
 */
export async function clearAll(): Promise<void> {
  const client = initRedis();
  
  if (!client) {
    memoryStore = {
      version: CURRENT_VERSION,
      lastUpdated: new Date().toISOString(),
      positions: [],
      webhook: null,
    };
    console.log('[Persistence] Memory store cleared');
    return;
  }
  
  try {
    await Promise.all([
      client.del(KEYS.POSITIONS),
      client.del(KEYS.WEBHOOK),
      client.del(KEYS.LAST_CHECK),
      client.del(KEYS.VERSION),
    ]);
    cachedData = null;
    console.log('[Persistence] Redis data cleared');
  } catch (error: any) {
    console.error(`[Persistence] Failed to clear Redis: ${error.message}`);
  }
}

// Export sync wrappers for backwards compatibility
// These work with the cached data and trigger async saves

export default {
  loadData,
  loadDataSync,
  saveData,
  addPosition,
  removePosition,
  getPositions,
  setWebhook,
  getWebhook,
  setLastCheck,
  getLastCheck,
  getStorageInfo,
  clearAll,
  isRedisAvailable,
};
