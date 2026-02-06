/**
 * Unified Onboarding System
 * 
 * Single entry point for both humans (Telegram) and agents (API).
 * Creates wallet, sets up notifications, starts monitoring.
 */

import { Redis } from '@upstash/redis';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config/index.js';
import {
  upsertRecipient,
  getRecipient,
  getWalletByChatId,
  type NotificationRecipient,
} from '../notifications/index.js';
import { discoverAllPositions } from '../utils/position-discovery.js';

// Redis keys for user data
const KEYS = {
  USER: (walletId: string) => `lp:user:${walletId}`,
  CHAT_WALLET: (chatId: string | number) => `lp:chat:${chatId}:wallet`,
};

export interface UserProfile {
  walletId: string;
  walletAddress: string;
  telegram?: {
    chatId: number | string;
    username?: string;
    linkedAt: string;
  };
  webhook?: {
    url: string;
    secret?: string;
    linkedAt: string;
  };
  createdAt: string;
  lastSeen: string;
}

export interface OnboardResult {
  success: boolean;
  isNew: boolean;
  user: UserProfile;
  positions?: Array<{
    address: string;
    pool: string;
    inRange: boolean;
  }>;
  message: string;
}

// Redis client
let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) throw new Error('Redis not configured');
  
  redis = new Redis({ url, token });
  return redis;
}

// Privy client loader (lazy)
let privyClient: any = null;
async function getPrivyClient() {
  if (privyClient) return privyClient;
  
  try {
    const module = await import('../mpc/privyClient.js');
    privyClient = new module.PrivyWalletClient({
      appId: process.env.PRIVY_APP_ID || '',
      appSecret: process.env.PRIVY_APP_SECRET || '',
      authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    });
    return privyClient;
  } catch (e: any) {
    console.error('[Onboarding] Failed to load Privy:', e.message);
    return null;
  }
}

// ============ User Profile Management ============

export async function getUserProfile(walletId: string): Promise<UserProfile | null> {
  const client = getRedis();
  return client.get<UserProfile>(KEYS.USER(walletId));
}

export async function getUserByChat(chatId: string | number): Promise<UserProfile | null> {
  const client = getRedis();
  const walletId = await client.get<string>(KEYS.CHAT_WALLET(chatId));
  if (!walletId) return null;
  return getUserProfile(walletId);
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const client = getRedis();
  profile.lastSeen = new Date().toISOString();
  await client.set(KEYS.USER(profile.walletId), profile);
  
  // Create reverse lookup for Telegram
  if (profile.telegram?.chatId) {
    await client.set(KEYS.CHAT_WALLET(profile.telegram.chatId), profile.walletId);
  }
}

// ============ Onboarding Functions ============

/**
 * Onboard a new user via Telegram
 * Creates wallet, links Telegram, returns ready-to-use profile
 */
export async function onboardTelegram(chatId: number | string, username?: string): Promise<OnboardResult> {
  // Check if already onboarded
  const existing = await getUserByChat(chatId);
  
  if (existing) {
    // Return existing user with positions
    const positions = await getUserPositions(existing.walletAddress);
    
    return {
      success: true,
      isNew: false,
      user: existing,
      positions,
      message: 'Welcome back!',
    };
  }
  
  // Create new Privy wallet
  const privy = await getPrivyClient();
  if (!privy) {
    throw new Error('Wallet service unavailable');
  }
  
  const wallet = await privy.generateWallet();
  const now = new Date().toISOString();
  
  // Create user profile
  const profile: UserProfile = {
    walletId: wallet.id,
    walletAddress: wallet.addresses.solana,
    telegram: {
      chatId,
      username,
      linkedAt: now,
    },
    createdAt: now,
    lastSeen: now,
  };
  
  await saveUserProfile(profile);
  
  // Also register for notifications
  await upsertRecipient({
    walletId: wallet.id,
    telegram: {
      chatId,
      linkedAt: now,
    },
    preferences: {
      alertOnOutOfRange: true,
      alertOnBackInRange: true,
      dailySummary: false,
      autoRebalance: false,
      rebalanceThreshold: 5,
    },
  });
  
  console.log(`[Onboarding] New Telegram user: ${chatId} → wallet ${wallet.id}`);
  
  return {
    success: true,
    isNew: true,
    user: profile,
    positions: [],
    message: 'Wallet created! Send SOL to get started.',
  };
}

/**
 * Onboard a new agent via API
 * Creates wallet, registers webhook, returns ready-to-use profile
 */
export async function onboardAgent(webhookUrl: string, webhookSecret?: string): Promise<OnboardResult> {
  // Create new Privy wallet
  const privy = await getPrivyClient();
  if (!privy) {
    throw new Error('Wallet service unavailable');
  }
  
  const wallet = await privy.generateWallet();
  const now = new Date().toISOString();
  
  // Create user profile
  const profile: UserProfile = {
    walletId: wallet.id,
    walletAddress: wallet.addresses.solana,
    webhook: {
      url: webhookUrl,
      secret: webhookSecret,
      linkedAt: now,
    },
    createdAt: now,
    lastSeen: now,
  };
  
  await saveUserProfile(profile);
  
  // Also register for notifications
  await upsertRecipient({
    walletId: wallet.id,
    webhook: {
      url: webhookUrl,
      secret: webhookSecret,
      linkedAt: now,
    },
    preferences: {
      alertOnOutOfRange: true,
      alertOnBackInRange: true,
      dailySummary: false,
      autoRebalance: true, // Agents typically want auto
      rebalanceThreshold: 5,
    },
  });
  
  console.log(`[Onboarding] New agent: webhook ${webhookUrl} → wallet ${wallet.id}`);
  
  return {
    success: true,
    isNew: true,
    user: profile,
    positions: [],
    message: 'Agent wallet created. Ready for deposits.',
  };
}

// ============ Position Discovery ============

/**
 * Get all LP positions for a wallet
 */
export async function getUserPositions(walletAddress: string): Promise<Array<{
  address: string;
  pool: string;
  poolAddress: string;
  inRange: boolean;
  amounts?: { tokenX: string; tokenY: string };
}>> {
  try {
    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const positions = await discoverAllPositions(connection, walletAddress);
    
    return positions.map(p => ({
      address: p.address,
      pool: p.pool?.name || 'Unknown',
      poolAddress: p.pool?.address || '',
      inRange: p.inRange,
      amounts: p.amounts,
    }));
  } catch (error: any) {
    console.error('[Onboarding] Position discovery failed:', error.message);
    return [];
  }
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(walletAddress: string): Promise<{
  sol: number;
  tokens: Array<{ symbol: string; amount: number }>;
}> {
  try {
    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pubkey = new PublicKey(walletAddress);
    
    // Get SOL balance
    const solBalance = await connection.getBalance(pubkey);
    
    // Get token balances
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });
    
    const tokens = tokenAccounts.value
      .map(acc => ({
        symbol: acc.account.data.parsed.info.mint.slice(0, 4) + '...',
        amount: parseFloat(acc.account.data.parsed.info.tokenAmount.uiAmountString || '0'),
      }))
      .filter(t => t.amount > 0);
    
    return {
      sol: solBalance / 1e9,
      tokens,
    };
  } catch (error: any) {
    console.error('[Onboarding] Balance check failed:', error.message);
    return { sol: 0, tokens: [] };
  }
}

// ============ Telegram Command Handlers ============

/**
 * Handle /start - Onboard new user or welcome back
 */
export async function handleStart(chatId: number | string, username?: string): Promise<string> {
  try {
    const result = await onboardTelegram(chatId, username);
    
    if (result.isNew) {
      return [
        `🎉 *Welcome to MnM LP Toolkit!*`,
        ``,
        `Your wallet is ready:`,
        `\`${result.user.walletAddress}\``,
        ``,
        `📥 *Next step:* Send SOL to this address`,
        ``,
        `Once funded, use:`,
        `• /balance - Check your balance`,
        `• /positions - View LP positions`,
        `• /lp - Create new position`,
        `• /help - All commands`,
      ].join('\n');
    } else {
      // Returning user
      const balance = await getWalletBalance(result.user.walletAddress);
      const posCount = result.positions?.length || 0;
      
      return [
        `👋 *Welcome back!*`,
        ``,
        `💰 Balance: ${balance.sol.toFixed(4)} SOL`,
        `📊 Positions: ${posCount}`,
        ``,
        `Commands:`,
        `• /balance - Check balance`,
        `• /positions - View positions`,
        `• /lp - Create position`,
      ].join('\n');
    }
  } catch (error: any) {
    console.error('[Telegram] Start error:', error);
    return `❌ Error: ${error.message}\n\nPlease try again or contact support.`;
  }
}

/**
 * Handle /balance - Show wallet balance
 */
export async function handleBalance(chatId: number | string): Promise<string> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return `❌ No wallet found. Use /start to create one.`;
  }
  
  const balance = await getWalletBalance(user.walletAddress);
  
  const tokenLines = balance.tokens.length > 0
    ? balance.tokens.map(t => `• ${t.symbol}: ${t.amount.toFixed(4)}`).join('\n')
    : '• No tokens';
  
  return [
    `💰 *Wallet Balance*`,
    ``,
    `Address: \`${user.walletAddress.slice(0, 8)}...${user.walletAddress.slice(-4)}\``,
    ``,
    `*SOL:* ${balance.sol.toFixed(4)}`,
    ``,
    `*Tokens:*`,
    tokenLines,
  ].join('\n');
}

/**
 * Handle /positions - Show all LP positions
 */
export async function handlePositions(chatId: number | string): Promise<string> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return `❌ No wallet found. Use /start to create one.`;
  }
  
  const positions = await getUserPositions(user.walletAddress);
  
  if (positions.length === 0) {
    return [
      `📊 *No LP Positions*`,
      ``,
      `You don't have any LP positions yet.`,
      ``,
      `Use /lp to create your first position!`,
    ].join('\n');
  }
  
  const posLines = positions.map(p => {
    const status = p.inRange ? '✅' : '⚠️';
    return `${status} *${p.pool}*\n   \`${p.address.slice(0, 8)}...\``;
  }).join('\n\n');
  
  return [
    `📊 *Your LP Positions*`,
    ``,
    posLines,
    ``,
    `_Checked just now_`,
  ].join('\n');
}

/**
 * Handle /status - Combined status view
 */
export async function handleStatus(chatId: number | string): Promise<string> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return `❌ No wallet found. Use /start to create one.`;
  }
  
  const [balance, positions] = await Promise.all([
    getWalletBalance(user.walletAddress),
    getUserPositions(user.walletAddress),
  ]);
  
  const inRange = positions.filter(p => p.inRange).length;
  const outOfRange = positions.length - inRange;
  
  const statusEmoji = outOfRange > 0 ? '⚠️' : '✅';
  
  return [
    `${statusEmoji} *Portfolio Status*`,
    ``,
    `💰 *Balance:* ${balance.sol.toFixed(4)} SOL`,
    `📊 *Positions:* ${positions.length}`,
    `   • In range: ${inRange}`,
    outOfRange > 0 ? `   • Out of range: ${outOfRange} ⚠️` : '',
    ``,
    `_Use /positions for details_`,
  ].filter(Boolean).join('\n');
}

export default {
  onboardTelegram,
  onboardAgent,
  getUserProfile,
  getUserByChat,
  getUserPositions,
  getWalletBalance,
  handleStart,
  handleBalance,
  handlePositions,
  handleStatus,
};
