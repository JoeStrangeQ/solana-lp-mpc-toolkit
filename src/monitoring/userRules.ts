/**
 * User Rules & Settings System
 * 
 * Stores per-user preferences and alert rules in Redis.
 * Supports natural language rule definitions.
 */

import { Redis } from '@upstash/redis';

// Redis keys
const KEYS = {
  USER_SETTINGS: (userId: string) => `lp-toolkit:user:${userId}:settings`,
  USER_RULES: (userId: string) => `lp-toolkit:user:${userId}:rules`,
  USER_POSITIONS: (userId: string) => `lp-toolkit:user:${userId}:positions`,
  ALL_USERS: 'lp-toolkit:users',
};

export interface UserSettings {
  userId: string;
  telegram?: {
    chatId: number | string;
    username?: string;
  };
  webhook?: {
    url: string;
    secret?: string;
  };
  preferences: {
    alertOnOutOfRange: boolean;
    alertOnValueChange: number; // percentage threshold, 0 = disabled
    autoRebalance: boolean; // If true, auto-execute. If false, ask first.
    rebalanceThreshold: number; // % out of range before triggering rebalance
    quietHours?: { start: number; end: number }; // UTC hours
    dailySummary: boolean;
    dailySummaryTime?: string; // "09:00" format
  };
  createdAt: string;
  updatedAt: string;
}

export interface UserRule {
  id: string;
  userId: string;
  type: 'price_alert' | 'out_of_range' | 'rebalance' | 'custom';
  condition: {
    // Price alerts
    token?: string;
    operator?: 'above' | 'below' | 'crosses';
    price?: number;
    // Position alerts
    positionAddress?: string;
    poolAddress?: string;
    outOfRangeMinutes?: number; // Alert after X minutes out of range
    // Rebalance triggers
    rebalanceIfOutOfRange?: boolean;
    autoExecute?: boolean;
  };
  action: {
    type: 'alert' | 'rebalance' | 'both';
    message?: string; // Custom message
  };
  enabled: boolean;
  triggered: boolean;
  lastTriggered?: string;
  createdAt: string;
  rawCommand?: string; // Original natural language command
}

export interface TrackedPosition {
  positionAddress: string;
  poolAddress: string;
  poolName: string;
  userId: string;
  walletId?: string;
  binRange: { lower: number; upper: number };
  lastChecked?: string;
  lastInRange?: boolean;
  outOfRangeSince?: string;
  createdAt: string;
}

// Redis client
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.warn('[UserRules] Redis not configured');
    return null;
  }
  
  redis = new Redis({ url, token });
  return redis;
}

// ============ User Settings ============

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const client = getRedis();
  if (!client) return null;
  
  try {
    return await client.get<UserSettings>(KEYS.USER_SETTINGS(userId));
  } catch (error: any) {
    console.error(`[UserRules] Failed to get settings for ${userId}:`, error.message);
    return null;
  }
}

export async function setUserSettings(settings: UserSettings): Promise<void> {
  const client = getRedis();
  if (!client) throw new Error('Redis not configured');
  
  settings.updatedAt = new Date().toISOString();
  
  await client.set(KEYS.USER_SETTINGS(settings.userId), settings);
  await client.sadd(KEYS.ALL_USERS, settings.userId);
  
  console.log(`[UserRules] Updated settings for user ${settings.userId}`);
}

export async function createDefaultSettings(userId: string, telegram?: { chatId: number | string; username?: string }): Promise<UserSettings> {
  const settings: UserSettings = {
    userId,
    telegram,
    preferences: {
      alertOnOutOfRange: true,
      alertOnValueChange: 0, // Disabled by default
      autoRebalance: false, // Ask first by default
      rebalanceThreshold: 5, // 5% out of range
      dailySummary: true,
      dailySummaryTime: '09:00',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await setUserSettings(settings);
  return settings;
}

export async function getAllUsers(): Promise<string[]> {
  const client = getRedis();
  if (!client) return [];
  
  try {
    return await client.smembers(KEYS.ALL_USERS);
  } catch (error: any) {
    console.error('[UserRules] Failed to get all users:', error.message);
    return [];
  }
}

// ============ User Rules ============

export async function getUserRules(userId: string): Promise<UserRule[]> {
  const client = getRedis();
  if (!client) return [];
  
  try {
    const rules = await client.get<UserRule[]>(KEYS.USER_RULES(userId));
    return rules || [];
  } catch (error: any) {
    console.error(`[UserRules] Failed to get rules for ${userId}:`, error.message);
    return [];
  }
}

export async function addUserRule(rule: UserRule): Promise<void> {
  const client = getRedis();
  if (!client) throw new Error('Redis not configured');
  
  const rules = await getUserRules(rule.userId);
  
  // Check for duplicate
  const existingIndex = rules.findIndex(r => r.id === rule.id);
  if (existingIndex >= 0) {
    rules[existingIndex] = rule;
  } else {
    rules.push(rule);
  }
  
  await client.set(KEYS.USER_RULES(rule.userId), rules);
  console.log(`[UserRules] Added/updated rule ${rule.id} for user ${rule.userId}`);
}

export async function removeUserRule(userId: string, ruleId: string): Promise<void> {
  const client = getRedis();
  if (!client) throw new Error('Redis not configured');
  
  const rules = await getUserRules(userId);
  const filtered = rules.filter(r => r.id !== ruleId);
  
  await client.set(KEYS.USER_RULES(userId), filtered);
  console.log(`[UserRules] Removed rule ${ruleId} for user ${userId}`);
}

export async function updateRuleTriggered(userId: string, ruleId: string, triggered: boolean): Promise<void> {
  const rules = await getUserRules(userId);
  const rule = rules.find(r => r.id === ruleId);
  
  if (rule) {
    rule.triggered = triggered;
    rule.lastTriggered = new Date().toISOString();
    await addUserRule(rule);
  }
}

// ============ Tracked Positions ============

export async function getTrackedPositions(userId: string): Promise<TrackedPosition[]> {
  const client = getRedis();
  if (!client) return [];
  
  try {
    const positions = await client.get<TrackedPosition[]>(KEYS.USER_POSITIONS(userId));
    return positions || [];
  } catch (error: any) {
    console.error(`[UserRules] Failed to get positions for ${userId}:`, error.message);
    return [];
  }
}

export async function getAllTrackedPositions(): Promise<TrackedPosition[]> {
  const users = await getAllUsers();
  const allPositions: TrackedPosition[] = [];
  
  for (const userId of users) {
    const positions = await getTrackedPositions(userId);
    allPositions.push(...positions);
  }
  
  return allPositions;
}

export async function trackPosition(position: TrackedPosition): Promise<void> {
  const client = getRedis();
  if (!client) throw new Error('Redis not configured');
  
  const positions = await getTrackedPositions(position.userId);
  
  // Check for duplicate
  const existingIndex = positions.findIndex(p => p.positionAddress === position.positionAddress);
  if (existingIndex >= 0) {
    positions[existingIndex] = position;
  } else {
    positions.push(position);
  }
  
  await client.set(KEYS.USER_POSITIONS(position.userId), positions);
  console.log(`[UserRules] Tracking position ${position.positionAddress} for user ${position.userId}`);
}

export async function untrackPosition(userId: string, positionAddress: string): Promise<void> {
  const client = getRedis();
  if (!client) throw new Error('Redis not configured');
  
  const positions = await getTrackedPositions(userId);
  const filtered = positions.filter(p => p.positionAddress !== positionAddress);
  
  await client.set(KEYS.USER_POSITIONS(userId), filtered);
  console.log(`[UserRules] Untracked position ${positionAddress} for user ${userId}`);
}

export async function updatePositionStatus(
  userId: string, 
  positionAddress: string, 
  updates: Partial<TrackedPosition>
): Promise<void> {
  const positions = await getTrackedPositions(userId);
  const position = positions.find(p => p.positionAddress === positionAddress);
  
  if (position) {
    Object.assign(position, updates);
    await trackPosition(position);
  }
}

// ============ Natural Language Rule Parsing ============

/**
 * Parse natural language command into a rule
 * Examples:
 * - "alert me if SOL drops below $100"
 * - "rebalance MET-USDC if more than 10% out of range"
 * - "notify me when any position goes out of range"
 */
export function parseNaturalRule(userId: string, command: string): UserRule | null {
  const lowerCommand = command.toLowerCase();
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  // Pattern: "alert/notify me if/when SOL/token drops/falls below/above $X"
  const priceMatch = lowerCommand.match(
    /(alert|notify|tell)\s+me\s+(if|when)\s+(\w+)\s+(drops?|falls?|goes?|rises?|climbs?)\s+(below|above|under|over)\s+\$?([\d.]+)/
  );
  
  if (priceMatch) {
    const token = priceMatch[3].toUpperCase();
    const direction = priceMatch[5];
    const price = parseFloat(priceMatch[6]);
    
    return {
      id,
      userId,
      type: 'price_alert',
      condition: {
        token,
        operator: direction.includes('below') || direction.includes('under') ? 'below' : 'above',
        price,
      },
      action: { type: 'alert' },
      enabled: true,
      triggered: false,
      createdAt: new Date().toISOString(),
      rawCommand: command,
    };
  }
  
  // Pattern: "rebalance X if Y% out of range"
  const rebalanceMatch = lowerCommand.match(
    /rebalance\s+(\S+)\s+(if|when)\s+(more\s+than\s+)?(\d+)%?\s*(out\s+of\s+range)?/
  );
  
  if (rebalanceMatch) {
    const pool = rebalanceMatch[1].toUpperCase();
    const threshold = parseInt(rebalanceMatch[4]);
    const autoExecute = lowerCommand.includes('auto') || lowerCommand.includes('automatically');
    
    return {
      id,
      userId,
      type: 'rebalance',
      condition: {
        poolAddress: pool, // Will need to be resolved
        outOfRangeMinutes: 5,
        rebalanceIfOutOfRange: true,
        autoExecute,
      },
      action: { type: autoExecute ? 'rebalance' : 'both' },
      enabled: true,
      triggered: false,
      createdAt: new Date().toISOString(),
      rawCommand: command,
    };
  }
  
  // Pattern: "notify me when any position goes out of range"
  const outOfRangeMatch = lowerCommand.match(
    /(alert|notify|tell)\s+me\s+(if|when)\s+(any\s+)?(position|positions?)\s+(goes?|is|are)\s+out\s+of\s+range/
  );
  
  if (outOfRangeMatch) {
    return {
      id,
      userId,
      type: 'out_of_range',
      condition: {
        outOfRangeMinutes: 0, // Immediate
      },
      action: { type: 'alert' },
      enabled: true,
      triggered: false,
      createdAt: new Date().toISOString(),
      rawCommand: command,
    };
  }
  
  return null;
}

export default {
  getUserSettings,
  setUserSettings,
  createDefaultSettings,
  getAllUsers,
  getUserRules,
  addUserRule,
  removeUserRule,
  updateRuleTriggered,
  getTrackedPositions,
  getAllTrackedPositions,
  trackPosition,
  untrackPosition,
  updatePositionStatus,
  parseNaturalRule,
};
