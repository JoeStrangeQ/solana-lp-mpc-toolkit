/**
 * Unified Onboarding System
 * 
 * Single source of truth for user ↔ wallet ↔ notification mappings.
 * Supports both humans (Telegram) and agents (API).
 */

import { Redis } from '@upstash/redis';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config/index.js';
import { upsertRecipient } from '../notifications/index.js';
import { discoverAllPositions } from '../utils/position-discovery.js';

// ============ Redis Keys (UNIFIED) ============
const KEYS = {
  // User profile by wallet
  USER: (walletId: string) => `lp:user:${walletId}`,
  // Telegram chat → wallet mapping
  CHAT_WALLET: (chatId: string | number) => `lp:chat:${chatId}:wallet`,
  // Wallet → Telegram chat mapping (reverse)
  WALLET_CHAT: (walletId: string) => `lp:wallet:${walletId}:chat`,
  // All users set
  ALL_USERS: 'lp:users:all',
  // Legacy key check (from old notification system)
  LEGACY_RECIPIENT: (walletId: string) => `lp:notify:recipient:${walletId}`,
  LEGACY_CHAT_WALLET: (chatId: string | number) => `lp:notify:chat:${chatId}`,
};

// ============ Types ============
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
  preferences: {
    alertOnOutOfRange: boolean;
    alertOnBackInRange: boolean;
    dailySummary: boolean;
    autoRebalance: boolean;
    rebalanceThreshold: number;
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

// ============ Redis Client ============
let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) throw new Error('Redis not configured');
  
  redis = new Redis({ url, token });
  return redis;
}

// ============ Privy Client ============
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

/**
 * Get user profile by wallet ID
 */
export async function getUserProfile(walletId: string): Promise<UserProfile | null> {
  const client = getRedis();
  return client.get<UserProfile>(KEYS.USER(walletId));
}

/**
 * Get user by Telegram chat ID (checks both new and legacy systems)
 */
export async function getUserByChat(chatId: string | number): Promise<UserProfile | null> {
  const client = getRedis();
  
  // Check new system first
  let walletId = await client.get<string>(KEYS.CHAT_WALLET(chatId));
  
  // Check legacy system if not found
  if (!walletId) {
    walletId = await client.get<string>(KEYS.LEGACY_CHAT_WALLET(chatId));
    
    // If found in legacy, migrate to new system
    if (walletId) {
      console.log(`[Onboarding] Migrating legacy mapping: chat ${chatId} → wallet ${walletId}`);
      await client.set(KEYS.CHAT_WALLET(chatId), walletId);
      await client.set(KEYS.WALLET_CHAT(walletId), chatId);
    }
  }
  
  if (!walletId) return null;
  
  // Get full profile
  let profile = await getUserProfile(walletId);
  
  // If no profile but wallet exists, try to load from Privy and create profile
  if (!profile) {
    try {
      const privy = await getPrivyClient();
      if (privy) {
        const wallet = await privy.loadWallet(walletId);
        if (wallet) {
          profile = {
            walletId,
            walletAddress: wallet.address,
            telegram: {
              chatId,
              linkedAt: new Date().toISOString(),
            },
            preferences: {
              alertOnOutOfRange: true,
              alertOnBackInRange: true,
            dailySummary: false,
              autoRebalance: false,
              rebalanceThreshold: 5,
            },
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          };
          await saveUserProfile(profile);
        }
      }
    } catch (e) {
      console.error('[Onboarding] Failed to load wallet from Privy:', e);
    }
  }
  
  return profile;
}

/**
 * Get user by wallet address
 */
export async function getUserByAddress(walletAddress: string): Promise<UserProfile | null> {
  const client = getRedis();
  
  // Get all users and find by address
  const allUserIds = await client.smembers(KEYS.ALL_USERS);
  
  for (const walletId of allUserIds) {
    const profile = await getUserProfile(walletId);
    if (profile?.walletAddress === walletAddress) {
      return profile;
    }
  }
  
  return null;
}

/**
 * Save user profile
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const client = getRedis();
  profile.lastSeen = new Date().toISOString();
  
  await client.set(KEYS.USER(profile.walletId), profile);
  await client.sadd(KEYS.ALL_USERS, profile.walletId);
  
  // Update Telegram mappings if present
  if (profile.telegram?.chatId) {
    await client.set(KEYS.CHAT_WALLET(profile.telegram.chatId), profile.walletId);
    await client.set(KEYS.WALLET_CHAT(profile.walletId), String(profile.telegram.chatId));
  }
  
  // Sync to notification system
  await upsertRecipient({
    walletId: profile.walletId,
    telegram: profile.telegram ? {
      chatId: profile.telegram.chatId,
      linkedAt: profile.telegram.linkedAt,
    } : undefined,
    webhook: profile.webhook ? {
      url: profile.webhook.url,
      secret: profile.webhook.secret,
      linkedAt: profile.webhook.linkedAt,
    } : undefined,
    preferences: profile.preferences,
  });
}

/**
 * Link existing wallet to Telegram chat
 */
export async function linkWalletToChat(walletId: string, chatId: number | string, username?: string): Promise<UserProfile | null> {
  const client = getRedis();
  
  // Try to load wallet from Privy
  const privy = await getPrivyClient();
  if (!privy) {
    throw new Error('Wallet service unavailable');
  }
  
  let wallet;
  try {
    wallet = await privy.loadWallet(walletId);
  } catch (e: any) {
    throw new Error(`Wallet not found: ${walletId}`);
  }
  
  const now = new Date().toISOString();
  
  // Check if profile exists
  let profile = await getUserProfile(walletId);
  
  if (profile) {
    // Update existing profile with Telegram
    profile.telegram = {
      chatId,
      username,
      linkedAt: now,
    };
    profile.lastSeen = now;
  } else {
    // Create new profile
    profile = {
      walletId,
      walletAddress: wallet.address,
      telegram: {
        chatId,
        username,
        linkedAt: now,
      },
      preferences: {
        alertOnOutOfRange: true,
        alertOnBackInRange: true,
            dailySummary: false,
        autoRebalance: false,
        rebalanceThreshold: 5,
      },
      createdAt: now,
      lastSeen: now,
    };
  }
  
  await saveUserProfile(profile);
  
  console.log(`[Onboarding] Linked wallet ${walletId} to chat ${chatId}`);
  return profile;
}

// ============ Onboarding Functions ============

/**
 * Onboard via Telegram - finds existing wallet or creates new one
 */
export async function onboardTelegram(chatId: number | string, username?: string): Promise<OnboardResult> {
  // Check if already has a wallet
  const existing = await getUserByChat(chatId);
  
  if (existing) {
    // Return existing user with positions
    existing.lastSeen = new Date().toISOString();
    await saveUserProfile(existing);
    
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
    preferences: {
      alertOnOutOfRange: true,
      alertOnBackInRange: true,
            dailySummary: false,
      autoRebalance: false,
      rebalanceThreshold: 5,
    },
    createdAt: now,
    lastSeen: now,
  };
  
  await saveUserProfile(profile);
  
  console.log(`[Onboarding] New Telegram user: ${chatId} → wallet ${wallet.id}`);
  
  return {
    success: true,
    isNew: true,
    user: profile,
    positions: [],
    message: 'Wallet created!',
  };
}

/**
 * Onboard agent via API
 */
export async function onboardAgent(webhookUrl: string, webhookSecret?: string): Promise<OnboardResult> {
  const privy = await getPrivyClient();
  if (!privy) {
    throw new Error('Wallet service unavailable');
  }
  
  const wallet = await privy.generateWallet();
  const now = new Date().toISOString();
  
  const profile: UserProfile = {
    walletId: wallet.id,
    walletAddress: wallet.addresses.solana,
    webhook: {
      url: webhookUrl,
      secret: webhookSecret,
      linkedAt: now,
    },
    preferences: {
      alertOnOutOfRange: true,
      alertOnBackInRange: true,
            dailySummary: false,
      autoRebalance: true,
      rebalanceThreshold: 5,
    },
    createdAt: now,
    lastSeen: now,
  };
  
  await saveUserProfile(profile);
  
  console.log(`[Onboarding] New agent: webhook ${webhookUrl} → wallet ${wallet.id}`);
  
  return {
    success: true,
    isNew: true,
    user: profile,
    positions: [],
    message: 'Agent wallet created.',
  };
}

// ============ Position & Balance Functions ============

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
  tokens: Array<{ mint: string; symbol: string; amount: number }>;
}> {
  try {
    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pubkey = new PublicKey(walletAddress);
    
    const solBalance = await connection.getBalance(pubkey);
    
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });
    
    const tokens = tokenAccounts.value
      .map(acc => {
        const info = acc.account.data.parsed.info;
        return {
          mint: info.mint,
          symbol: info.mint.slice(0, 4) + '...',
          amount: parseFloat(info.tokenAmount.uiAmountString || '0'),
        };
      })
      .filter(t => t.amount > 0);
    
    return { sol: solBalance / 1e9, tokens };
  } catch (error: any) {
    console.error('[Onboarding] Balance check failed:', error.message);
    return { sol: 0, tokens: [] };
  }
}

// ============ Telegram Command Handlers ============

const BOT_INTRO = `
🤖 *MnM LP Agent Toolkit*

I help you manage Solana LP positions with AI-powered automation:

✨ *What I Can Do:*
• Create & manage your LP wallet (MPC-secured)
• Monitor positions 24/7 for out-of-range
• Alert you instantly when action needed
• Rebalance with one tap

🔐 *Security:*
Your funds are secured by Privy MPC - private keys never exposed, even to us.

🤝 *For AI Agents:*
Integrate via webhook for fully autonomous LP management.

Let's get started! 👇
`;

/**
 * Handle /start - Onboard or welcome back
 */
export async function handleStart(chatId: number | string, username?: string): Promise<string> {
  try {
    const result = await onboardTelegram(chatId, username);
    
    if (result.isNew) {
      return [
        BOT_INTRO,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🎉 *Your Wallet is Ready!*`,
        ``,
        `\`${result.user.walletAddress}\``,
        ``,
        `📥 *Next:* Send SOL to this address to start`,
        ``,
        `*Commands:*`,
        `/balance - Check your balance`,
        `/positions - View LP positions`,
        `/status - Portfolio overview`,
        `/help - All commands`,
      ].join('\n');
    } else {
      // Returning user
      const balance = await getWalletBalance(result.user.walletAddress);
      const posCount = result.positions?.length || 0;
      const inRange = result.positions?.filter(p => p.inRange).length || 0;
      
      return [
        `👋 *Welcome back!*`,
        ``,
        `💼 *Your Wallet:*`,
        `\`${result.user.walletAddress}\``,
        ``,
        `💰 *Balance:* ${balance.sol.toFixed(4)} SOL`,
        `📊 *Positions:* ${posCount} (${inRange} in range)`,
        ``,
        `/positions - View details`,
        `/status - Full overview`,
      ].join('\n');
    }
  } catch (error: any) {
    console.error('[Telegram] Start error:', error);
    return `❌ Error: ${error.message}\n\nPlease try again.`;
  }
}

/**
 * Handle /link <walletId> - Link existing wallet
 */
export async function handleLink(chatId: number | string, walletId: string, username?: string): Promise<string> {
  try {
    // Check if already has a wallet
    const existing = await getUserByChat(chatId);
    if (existing) {
      return [
        `⚠️ You already have a wallet linked:`,
        `\`${existing.walletAddress}\``,
        ``,
        `To link a different wallet, contact support.`,
      ].join('\n');
    }
    
    const profile = await linkWalletToChat(walletId, chatId, username);
    
    if (!profile) {
      return `❌ Wallet not found: ${walletId}`;
    }
    
    const balance = await getWalletBalance(profile.walletAddress);
    const positions = await getUserPositions(profile.walletAddress);
    
    return [
      `✅ *Wallet Linked!*`,
      ``,
      `\`${profile.walletAddress}\``,
      ``,
      `💰 Balance: ${balance.sol.toFixed(4)} SOL`,
      `📊 Positions: ${positions.length}`,
      ``,
      `You'll now receive alerts here.`,
    ].join('\n');
  } catch (error: any) {
    console.error('[Telegram] Link error:', error);
    return `❌ ${error.message}`;
  }
}

/**
 * Handle /balance
 */
export async function handleBalance(chatId: number | string): Promise<string> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return `❌ No wallet found. Use /start to create one.`;
  }
  
  const balance = await getWalletBalance(user.walletAddress);
  
  const tokenLines = balance.tokens.length > 0
    ? balance.tokens.map(t => `  • ${t.symbol}: ${t.amount.toFixed(4)}`).join('\n')
    : '  _No tokens_';
  
  return [
    `💰 *Wallet Balance*`,
    ``,
    `📍 \`${user.walletAddress.slice(0, 8)}...${user.walletAddress.slice(-4)}\``,
    ``,
    `*SOL:* ${balance.sol.toFixed(4)}`,
    ``,
    `*Tokens:*`,
    tokenLines,
  ].join('\n');
}

/**
 * Handle /positions
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
      `Deposit SOL and create your first position!`,
    ].join('\n');
  }
  
  const posLines = positions.map(p => {
    const status = p.inRange ? '✅' : '⚠️';
    return `${status} *${p.pool}*\n   \`${p.address.slice(0, 12)}...\``;
  }).join('\n\n');
  
  return [
    `📊 *Your LP Positions*`,
    ``,
    posLines,
    ``,
    `_Last checked: just now_`,
  ].join('\n');
}

/**
 * Handle /status
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
    `   • In range: ${inRange} ✅`,
    outOfRange > 0 ? `   • Out of range: ${outOfRange} ⚠️` : '',
    ``,
    `🔔 *Alerts:* ${user.preferences.alertOnOutOfRange ? 'On' : 'Off'}`,
    ``,
    `_Use /positions for details_`,
  ].filter(Boolean).join('\n');
}

/**
 * Handle /deposit - Show deposit address
 */
export async function handleDeposit(chatId: number | string): Promise<string> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return `❌ No wallet found. Use /start to create one.`;
  }
  
  return [
    `💳 *Deposit Address*`,
    ``,
    `Send SOL or SPL tokens to:`,
    ``,
    `\`${user.walletAddress}\``,
    ``,
    `⚠️ *Important:*`,
    `• Only send Solana assets`,
    `• Minimum deposit: 0.01 SOL`,
    `• Deposits are available immediately`,
    ``,
    `[View on Solscan](https://solscan.io/account/${user.walletAddress})`,
  ].join('\n');
}

/**
 * Handle /withdraw - Initiate withdrawal
 */
export async function handleWithdraw(chatId: number | string, args?: string): Promise<{ text: string; buttons?: any[][] }> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return { text: `❌ No wallet found. Use /start to create one.` };
  }
  
  const balance = await getWalletBalance(user.walletAddress);
  
  if (balance.sol < 0.001) {
    return { 
      text: [
        `📤 *Withdraw*`,
        ``,
        `Insufficient balance: ${balance.sol.toFixed(4)} SOL`,
        ``,
        `Deposit SOL first using /deposit`,
      ].join('\n')
    };
  }
  
  // If no args, show withdraw options
  if (!args) {
    return {
      text: [
        `📤 *Withdraw Funds*`,
        ``,
        `💰 Available: ${balance.sol.toFixed(4)} SOL`,
        ``,
        `Choose an option:`,
      ].join('\n'),
      buttons: [
        [
          { text: '📤 Withdraw All', callback_data: `withdraw_all:${user.walletId}` },
        ],
        [
          { text: '📊 Withdraw from LP', callback_data: `withdraw_lp:${user.walletId}` },
        ],
        [
          { text: '❌ Cancel', callback_data: 'dismiss' },
        ],
      ],
    };
  }
  
  return {
    text: [
      `📤 *Withdraw*`,
      ``,
      `To withdraw, use the buttons below or call:`,
      `\`POST /lp/withdraw/atomic\``,
      ``,
      `Your transactions are:`,
      `🔐 Encrypted with Arcium`,
      `⚡ Bundled via Jito (MEV-protected)`,
    ].join('\n'),
  };
}

/**
 * Handle /settings - Alert preferences
 */
export async function handleSettings(chatId: number | string): Promise<{ text: string; buttons?: any[][] }> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return { text: `❌ No wallet found. Use /start to create one.` };
  }
  
  const prefs = user.preferences;
  
  return {
    text: [
      `⚙️ *Alert Settings*`,
      ``,
      `🔔 Out of Range: ${prefs.alertOnOutOfRange ? '✅ On' : '❌ Off'}`,
      `🔄 Auto-Rebalance: ${prefs.autoRebalance ? '✅ On' : '❌ Off'}`,
      `📊 Daily Summary: ${prefs.dailySummary ? '✅ On' : '❌ Off'}`,
      ``,
      `Tap to toggle:`,
    ].join('\n'),
    buttons: [
      [
        { 
          text: prefs.alertOnOutOfRange ? '🔔 Alerts: ON' : '🔕 Alerts: OFF', 
          callback_data: `toggle_alerts:${user.walletId}` 
        },
      ],
      [
        { 
          text: prefs.autoRebalance ? '🔄 Auto-Rebalance: ON' : '⏸️ Auto-Rebalance: OFF', 
          callback_data: `toggle_rebalance:${user.walletId}` 
        },
      ],
      [
        { 
          text: prefs.dailySummary ? '📊 Daily Summary: ON' : '📊 Daily Summary: OFF', 
          callback_data: `toggle_summary:${user.walletId}` 
        },
      ],
      [
        { text: '✅ Done', callback_data: 'dismiss' },
      ],
    ],
  };
}

export default {
  getUserProfile,
  getUserByChat,
  getUserByAddress,
  saveUserProfile,
  linkWalletToChat,
  onboardTelegram,
  onboardAgent,
  getUserPositions,
  getWalletBalance,
  handleStart,
  handleLink,
  handleBalance,
  handlePositions,
  handleStatus,
  handleDeposit,
  handleWithdraw,
  handleSettings,
};
