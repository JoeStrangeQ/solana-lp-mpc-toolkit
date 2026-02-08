/**
 * Pool Data Cache Service
 * 
 * Caches Meteora DLMM pool data to reduce RPC calls.
 * Uses Redis if available, falls back to in-memory cache.
 * 
 * Cache keys:
 * - pool:info:{address} - Pool info (TVL, fees, tokens, etc.)
 * - pool:bins:{address} - Active bin data
 * 
 * TTL: 60s for pool info (changes rarely), 10s for bin data (changes frequently)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { Redis } from '@upstash/redis';

// Cache TTLs in seconds
const POOL_INFO_TTL = 60;  // Pool metadata changes rarely
const BIN_DATA_TTL = 10;   // Active bin changes with trades
const DLMM_INSTANCE_TTL = 300; // DLMM instance cache (5 min, in-memory only)

// In-memory cache for DLMM instances (can't serialize to Redis)
const dlmmCache = new Map<string, { instance: any; expires: number }>();

// In-memory fallback cache
const memoryCache = new Map<string, { data: any; expires: number }>();

// Redis client (lazy init)
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) return null;
  
  try {
    redis = new Redis({ url, token });
    return redis;
  } catch {
    return null;
  }
}

/**
 * Get cached value from Redis or memory
 */
async function getCached<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value) {
        return value as T;
      }
    } catch (e) {
      console.warn(`[PoolCache] Redis get failed: ${(e as Error).message}`);
    }
  }
  
  // Fallback to memory cache
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }
  
  return null;
}

/**
 * Set cached value in Redis and memory
 */
async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  
  // Always set in memory as fallback
  memoryCache.set(key, {
    data: value,
    expires: Date.now() + ttlSeconds * 1000,
  });
  
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch (e) {
      console.warn(`[PoolCache] Redis set failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Invalidate cache for a pool
 */
export async function invalidatePoolCache(poolAddress: string): Promise<void> {
  const keys = [`pool:info:${poolAddress}`, `pool:bins:${poolAddress}`];
  
  // Clear memory cache
  keys.forEach(key => memoryCache.delete(key));
  dlmmCache.delete(poolAddress);
  
  // Clear Redis
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(...keys);
    } catch (e) {
      console.warn(`[PoolCache] Redis del failed: ${(e as Error).message}`);
    }
  }
  
  console.log(`[PoolCache] Invalidated cache for ${poolAddress.slice(0, 8)}...`);
}

/**
 * Get or create cached DLMM instance
 * These are heavy to create (multiple RPC calls), so we cache them in-memory
 */
export async function getCachedDLMM(
  connection: Connection,
  poolAddress: string
): Promise<any> {
  const now = Date.now();
  const cached = dlmmCache.get(poolAddress);
  
  if (cached && cached.expires > now) {
    return cached.instance;
  }
  
  // Create new instance
  console.log(`[PoolCache] Creating DLMM instance for ${poolAddress.slice(0, 8)}...`);
  const instance = await DLMM.create(connection, new PublicKey(poolAddress));
  
  dlmmCache.set(poolAddress, {
    instance,
    expires: now + DLMM_INSTANCE_TTL * 1000,
  });
  
  return instance;
}

/**
 * Pool info structure (cached)
 */
export interface CachedPoolInfo {
  address: string;
  tokenX: { mint: string; symbol: string; decimals: number };
  tokenY: { mint: string; symbol: string; decimals: number };
  binStep: number;
  baseFee: number;
  activeBin: number;
  activePrice: number;
  tvl?: { tokenX: number; tokenY: number };
  cachedAt: number;
}

/**
 * Get pool info with caching
 */
export async function getCachedPoolInfo(
  connection: Connection,
  poolAddress: string
): Promise<CachedPoolInfo> {
  const cacheKey = `pool:info:${poolAddress}`;
  
  // Check cache first
  const cached = await getCached<CachedPoolInfo>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Fetch from chain
  console.log(`[PoolCache] Fetching pool info for ${poolAddress.slice(0, 8)}...`);
  const pool = await getCachedDLMM(connection, poolAddress);
  
  const activeBin = await pool.getActiveBin();
  const tokenX = pool.tokenX;
  const tokenY = pool.tokenY;
  
  const info: CachedPoolInfo = {
    address: poolAddress,
    tokenX: {
      mint: tokenX.publicKey.toBase58(),
      symbol: tokenX.symbol || 'UNKNOWN',
      decimals: tokenX.decimal,
    },
    tokenY: {
      mint: tokenY.publicKey.toBase58(),
      symbol: tokenY.symbol || 'UNKNOWN',
      decimals: tokenY.decimal,
    },
    binStep: pool.lbPair.binStep,
    baseFee: pool.lbPair.parameters.baseFactor / 10000, // Convert to percentage
    activeBin: activeBin.binId,
    activePrice: parseFloat(activeBin.price),
    cachedAt: Date.now(),
  };
  
  // Cache it
  await setCached(cacheKey, info, POOL_INFO_TTL);
  
  return info;
}

/**
 * Bin data structure (cached)
 */
export interface CachedBinData {
  activeBinId: number;
  activePrice: number;
  bins: Array<{
    binId: number;
    price: number;
    liquidityX: number;
    liquidityY: number;
  }>;
  cachedAt: number;
}

/**
 * Get active bin data with caching (shorter TTL since it changes with trades)
 */
export async function getCachedBinData(
  connection: Connection,
  poolAddress: string
): Promise<CachedBinData> {
  const cacheKey = `pool:bins:${poolAddress}`;
  
  // Check cache first
  const cached = await getCached<CachedBinData>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Fetch from chain
  console.log(`[PoolCache] Fetching bin data for ${poolAddress.slice(0, 8)}...`);
  const pool = await getCachedDLMM(connection, poolAddress);
  
  const activeBin = await pool.getActiveBin();
  const binsAroundActive = await pool.getBinsBetweenLowerAndUpperBound(
    activeBin.binId - 10,
    activeBin.binId + 10
  );
  
  const binData: CachedBinData = {
    activeBinId: activeBin.binId,
    activePrice: parseFloat(activeBin.price),
    bins: binsAroundActive.map((bin: any) => ({
      binId: bin.binId,
      price: parseFloat(bin.price),
      liquidityX: parseInt(bin.xAmount?.toString() || '0'),
      liquidityY: parseInt(bin.yAmount?.toString() || '0'),
    })),
    cachedAt: Date.now(),
  };
  
  // Cache with shorter TTL
  await setCached(cacheKey, binData, BIN_DATA_TTL);
  
  return binData;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  dlmmInstances: number;
  memoryEntries: number;
  redisAvailable: boolean;
} {
  return {
    dlmmInstances: dlmmCache.size,
    memoryEntries: memoryCache.size,
    redisAvailable: getRedis() !== null,
  };
}

/**
 * Clear all caches (for testing or manual reset)
 */
export async function clearAllCaches(): Promise<void> {
  dlmmCache.clear();
  memoryCache.clear();
  
  const redis = getRedis();
  if (redis) {
    try {
      // Clear all pool: keys
      const keys = await redis.keys('pool:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (e) {
      console.warn(`[PoolCache] Redis clear failed: ${(e as Error).message}`);
    }
  }
  
  console.log('[PoolCache] All caches cleared');
}
