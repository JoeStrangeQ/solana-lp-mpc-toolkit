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
    alertOnValueChange?: number; // % value change to trigger alert
    quietHours?: { start: number; end: number }; // UTC hours when alerts are silenced
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
export interface PositionDetails {
  address: string;
  pool: string;
  poolAddress: string;
  inRange: boolean;
  priceRange: {
    lower: number;
    upper: number;
    current: number;
    display: string;
  };
  amounts: {
    tokenX: { symbol: string; amount: number; formatted: string };
    tokenY: { symbol: string; amount: number; formatted: string };
  };
  fees: {
    tokenX: string;
    tokenY: string;
  };
  solscanUrl: string;
}

export async function getUserPositions(walletAddress: string): Promise<PositionDetails[]> {
  try {
    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const positions = await discoverAllPositions(connection, walletAddress);
    
    return positions.map(p => {
      const tokenXSymbol = p.pool?.tokenX?.symbol || 'X';
      const tokenYSymbol = p.pool?.tokenY?.symbol || 'Y';
      const tokenXDecimals = p.pool?.tokenX?.decimals || 6;
      const tokenYDecimals = p.pool?.tokenY?.decimals || 6;
      
      const tokenXAmount = parseInt(p.amounts?.tokenX || '0') / Math.pow(10, tokenXDecimals);
      const tokenYAmount = parseInt(p.amounts?.tokenY || '0') / Math.pow(10, tokenYDecimals);
      
      return {
        address: p.address,
        pool: p.pool?.name || 'Unknown',
        poolAddress: p.pool?.address || '',
        inRange: p.inRange,
        priceRange: {
          lower: p.priceRange?.priceLower || 0,
          upper: p.priceRange?.priceUpper || 0,
          current: p.priceRange?.currentPrice || 0,
          display: p.priceRange?.display || '',
        },
        amounts: {
          tokenX: {
            symbol: tokenXSymbol,
            amount: tokenXAmount,
            formatted: `${tokenXAmount.toFixed(4)} ${tokenXSymbol}`,
          },
          tokenY: {
            symbol: tokenYSymbol,
            amount: tokenYAmount,
            formatted: `${tokenYAmount.toFixed(4)} ${tokenYSymbol}`,
          },
        },
        fees: {
          tokenX: p.fees?.tokenXFormatted || '0',
          tokenY: p.fees?.tokenYFormatted || '0',
        },
        solscanUrl: p.solscanUrl || `https://solscan.io/account/${p.address}`,
      };
    });
  } catch (error: any) {
    console.error('[Onboarding] Position discovery failed:', error.message);
    return [];
  }
}

// Known token symbols
const TOKEN_SYMBOLS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL': 'MET',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 'WIF',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': 'JTO',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'ETH',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': 'PYTH',
};

/**
 * Get wallet balance
 */
export async function getWalletBalance(walletAddress: string): Promise<{
  sol: number;
  solUsd: number;
  tokens: Array<{ mint: string; symbol: string; amount: number; usd?: number }>;
  totalUsd: number;
}> {
  try {
    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pubkey = new PublicKey(walletAddress);
    
    const solBalance = await connection.getBalance(pubkey);
    const sol = solBalance / 1e9;
    
    // Get SOL price (approximate)
    const solPrice = 105; // TODO: fetch from Jupiter
    const solUsd = sol * solPrice;
    
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });
    
    const tokens = tokenAccounts.value
      .map(acc => {
        const info = acc.account.data.parsed.info;
        const mint = info.mint;
        const symbol = TOKEN_SYMBOLS[mint] || mint.slice(0, 6) + '...';
        const amount = parseFloat(info.tokenAmount.uiAmountString || '0');
        
        // Rough USD estimate for stablecoins
        let usd: number | undefined;
        if (symbol === 'USDC' || symbol === 'USDT') {
          usd = amount;
        }
        
        return { mint, symbol, amount, usd };
      })
      .filter(t => t.amount > 0.0001);
    
    const tokenUsd = tokens.reduce((sum, t) => sum + (t.usd || 0), 0);
    
    return { sol, solUsd, tokens, totalUsd: solUsd + tokenUsd };
  } catch (error: any) {
    console.error('[Onboarding] Balance check failed:', error.message);
    return { sol: 0, solUsd: 0, tokens: [], totalUsd: 0 };
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
 * Handle /balance - returns rich text with optional buttons
 */
export async function handleBalance(chatId: number | string): Promise<{ text: string; buttons?: any[][] }> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return { text: `❌ No wallet found. Use /start to create one.` };
  }
  
  const balance = await getWalletBalance(user.walletAddress);
  
  const tokenLines = balance.tokens.length > 0
    ? balance.tokens.map(t => {
        const usdStr = t.usd ? ` (~$${t.usd.toFixed(2)})` : '';
        return `  • *${t.symbol}:* ${t.amount.toFixed(4)}${usdStr}`;
      }).join('\n')
    : '  _No tokens_';
  
  const text = [
    `💰 *Wallet Balance*`,
    ``,
    `💵 *Total:* ~$${balance.totalUsd.toFixed(2)}`,
    ``,
    `⬤ *SOL:* ${balance.sol.toFixed(4)} (~$${balance.solUsd.toFixed(2)})`,
    ``,
    `🪙 *Tokens:*`,
    tokenLines,
    ``,
    `📍 \`${user.walletAddress.slice(0, 8)}...${user.walletAddress.slice(-6)}\``,
    ``,
    `[View on Solscan](https://solscan.io/account/${user.walletAddress})`,
  ].join('\n');
  
  // Add "Swap All to SOL" button if there are non-SOL tokens
  const buttons: any[][] = [];
  
  if (balance.tokens.length > 0) {
    // Format: swap_all:walletId
    buttons.push([
      { text: '🔄 Swap All to SOL', callback_data: `swap_all:${user.walletId}` }
    ]);
  }
  
  // Always show refresh button
  buttons.push([
    { text: '🔄 Refresh', callback_data: `refresh_balance` }
  ]);
  
  return { text, buttons: buttons.length > 0 ? buttons : undefined };
}

/**
 * Handle /positions - returns rich text with optional buttons
 */
export async function handlePositions(chatId: number | string): Promise<{ text: string; buttons?: any[][] }> {
  const user = await getUserByChat(chatId);
  
  if (!user) {
    return { text: `❌ No wallet found. Use /start to create one.` };
  }
  
  const positions = await getUserPositions(user.walletAddress);
  
  if (positions.length === 0) {
    return {
      text: [
        `📊 *No LP Positions*`,
        ``,
        `You don't have any LP positions yet.`,
        ``,
        `Deposit SOL first (/deposit), then create a position.`,
      ].join('\n'),
    };
  }
  
  const posLines = positions.map((p, i) => {
    const status = p.inRange ? '🟢' : '🔴';
    const rangeStatus = p.inRange ? 'IN RANGE ✅' : 'OUT OF RANGE ⚠️';
    
    // Format price nicely
    const priceFmt = (n: number) => n < 1 ? n.toFixed(4) : n.toFixed(2);
    
    return [
      `${status} *${p.pool}* — ${rangeStatus}`,
      ``,
      `📍 *Price:* $${priceFmt(p.priceRange.current)}`,
      `📐 *Range:* $${priceFmt(p.priceRange.lower)} - $${priceFmt(p.priceRange.upper)}`,
      ``,
      `💰 *Position:*`,
      `   ${p.amounts.tokenX.formatted}`,
      `   ${p.amounts.tokenY.formatted}`,
      ``,
      `💎 *Fees Earned:*`,
      `   ${p.fees.tokenX} + ${p.fees.tokenY}`,
    ].join('\n');
  }).join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');
  
  // Build buttons for each position (all positions, up to 8)
  const buttons: any[][] = [];
  
  // Store position data in Redis for callback lookup (to avoid 64-byte Telegram limit)
  // For now, use shortened format with position index
  const positionMap: Record<string, { poolAddress: string; positionAddress: string }> = {};
  
  // Per-position action buttons
  for (let i = 0; i < Math.min(positions.length, 8); i++) {
    const p = positions[i];
    const rangeIcon = p.inRange ? '🟢' : '🔴';
    const posKey = `p${i}`; // Short key: p0, p1, p2, etc.
    
    // Store mapping for lookup
    positionMap[posKey] = { poolAddress: p.poolAddress, positionAddress: p.address };
    
    buttons.push([
      { text: `${rangeIcon} ${p.pool}`, callback_data: `pd:${posKey}` },
      { text: `📤 Withdraw`, callback_data: `wd:${posKey}` },
    ]);
  }
  
  // Store position map in user session (Redis) for callback lookup
  try {
    const client = getRedis();
    await client.set(`positions:${user.walletId}`, positionMap, { ex: 3600 }); // 1 hour TTL
  } catch (e) {
    console.error('Failed to cache position map:', e);
  }
  
  // General action buttons
  buttons.push([
    { text: '💸 Claim All Fees', callback_data: `claim_fees:${user.walletId}` },
    { text: '🔄 Rebalance All', callback_data: `rebalance:${user.walletId}` },
  ]);
  buttons.push([
    { text: '➕ Add New LP', callback_data: `add_lp:${user.walletId}` },
    { text: '🔄 Refresh', callback_data: `refresh_positions:${user.walletId}` },
  ]);
  
  return {
    text: [
      `📊 *Your LP Positions* (${positions.length})`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      posLines,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⏱ Monitoring: Every 5 min`,
      `🔔 Alerts: Active`,
    ].join('\n'),
    buttons,
  };
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

/**
 * Handle /pools - Show top pools with LP buttons
 */
export async function handlePools(chatId: number | string): Promise<{ text: string; buttons?: any[][] }> {
  const user = await getUserByChat(chatId);
  
  // Known popular base tokens (SOL, USDC, USDT, and top ecosystem tokens)
  const POPULAR_TOKENS = new Set([
    'SOL', 'USDC', 'USDT', 'JUP', 'BONK', 'WIF', 'RAY', 'mSOL', 'bSOL', 'JTO', 'PYTH',
    'ETH', 'stSOL', 'RENDER', 'HNT', 'RNDR', 'MET', 'FIDA', 'MNGO', 'SRM', 'ORCA',
  ]);
  
  // Fetch top pools from Meteora API
  let topPools: Array<{ name: string; address: string; apr: string; tvl: string; binStep: number }> = [];
  
  try {
    const meteoraResp = await fetch('https://dlmm-api.meteora.ag/pair/all');
    if (meteoraResp.ok) {
      const allPools = await meteoraResp.json() as any[];
      
      // Filter for pools with TVL > $100K
      const highTvlPools = allPools.filter(p => p.liquidity && parseFloat(p.liquidity) > 100000);
      
      // Categorize pools: popular token pairs vs others
      const popularPools = highTvlPools.filter(p => {
        const [tokenA, tokenB] = (p.name || '').split('-');
        return POPULAR_TOKENS.has(tokenA) || POPULAR_TOKENS.has(tokenB);
      });
      
      // Sort by APR
      const sortedPopular = popularPools.sort((a, b) => (b.apr || 0) - (a.apr || 0)).slice(0, 4);
      const sortedAll = highTvlPools.sort((a, b) => (b.apr || 0) - (a.apr || 0)).slice(0, 4);
      
      // Always include SOL-USDC as the first option (highest TVL)
      const solUsdcPools = highTvlPools
        .filter(p => p.name === 'SOL-USDC')
        .sort((a, b) => parseFloat(b.liquidity) - parseFloat(a.liquidity));
      
      // Combine: SOL-USDC first, then popular pools by APR, then others
      const combined = new Map<string, any>();
      
      // Add best SOL-USDC pool first
      if (solUsdcPools.length > 0) {
        combined.set(solUsdcPools[0].address, solUsdcPools[0]);
      }
      
      // Add popular pools
      for (const p of sortedPopular) {
        if (combined.size < 6) combined.set(p.address, p);
      }
      
      // Fill with highest APR pools
      for (const p of sortedAll) {
        if (combined.size < 6) combined.set(p.address, p);
      }
      
      topPools = Array.from(combined.values()).map(p => ({
        name: p.name || `${p.mint_x_symbol || '?'}-${p.mint_y_symbol || '?'}`,
        address: p.address,
        apr: p.apr > 0 ? `${p.apr.toFixed(1)}%` : '0%',
        tvl: formatTvl(parseFloat(p.liquidity)),
        binStep: p.bin_step || 0,
      }));
    }
  } catch (e) {
    console.error('Failed to fetch Meteora pools:', e);
  }
  
  // Fallback to known pools if API fails
  if (topPools.length === 0) {
    topPools = [
      { name: 'SOL-USDC', address: '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7', apr: '~10%', tvl: '$183K', binStep: 1 },
      { name: 'MET-USDC', address: '5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd', apr: '~5%', tvl: '$200K', binStep: 20 },
      { name: 'JUP-SOL', address: 'Bz8dN5dnr6UG6nPqBLDSiJrgxtNNubnXUMFdWCQTnLC1', apr: '~15%', tvl: '$500K', binStep: 10 },
    ];
  }
  
  const poolLines = topPools.map((p, i) => 
    `${i + 1}. *${p.name}* (bin: ${p.binStep})\n   📈 APR: ${p.apr} | 💰 TVL: ${p.tvl}`
  ).join('\n\n');
  
  const buttons: any[][] = topPools.map(p => ([
    { text: `🚀 LP into ${p.name}`, callback_data: `lp_pool:${p.address}:${p.name}` },
  ]));
  
  // Add refresh button
  buttons.push([{ text: '🔄 Refresh', callback_data: 'refresh_pools' }]);
  
  const walletNote = user 
    ? `\n\n💳 Wallet: \`${user.walletAddress.slice(0, 8)}...\`` 
    : `\n\n⚠️ Create a wallet first with /start`;
  
  return {
    text: [
      `🏊 *Top LP Pools by APR*`,
      `_(TVL > $100K, sorted by APR)_`,
      ``,
      poolLines,
      walletNote,
      ``,
      `_Tap a pool to start LPing!_`,
    ].join('\n'),
    buttons,
  };
}

// Helper to format TVL nicely
function formatTvl(tvl: number): string {
  if (tvl >= 1000000) {
    return `$${(tvl / 1000000).toFixed(1)}M`;
  } else if (tvl >= 1000) {
    return `$${(tvl / 1000).toFixed(0)}K`;
  }
  return `$${tvl.toFixed(0)}`;
}

/**
 * Handle LP entry flow - Step 1: Select amount
 */
export function handleLpAmountPrompt(poolAddress: string, poolName: string): { text: string; buttons: any[][] } {
  return {
    text: [
      `🚀 *LP into ${poolName}*`,
      ``,
      `How much SOL do you want to LP?`,
      ``,
      `🔐 Your strategy will be:`,
      `• Encrypted with Arcium`,
      `• Bundled via Jito (MEV-protected)`,
    ].join('\n'),
    buttons: [
      [
        { text: '0.1 SOL', callback_data: `lp_amount:${poolAddress}:0.1` },
        { text: '0.5 SOL', callback_data: `lp_amount:${poolAddress}:0.5` },
      ],
      [
        { text: '1 SOL', callback_data: `lp_amount:${poolAddress}:1` },
        { text: '5 SOL', callback_data: `lp_amount:${poolAddress}:5` },
      ],
      [
        { text: '❌ Cancel', callback_data: 'dismiss' },
      ],
    ],
  };
}

/**
 * Handle LP entry flow - Step 2: Select strategy
 */
export function handleLpStrategyPrompt(poolAddress: string, amount: string): { text: string; buttons: any[][] } {
  // Use short callback prefixes to stay under Telegram's 64-byte limit
  // lpx = lp_execute (shortened)
  return {
    text: [
      `📊 *Position Strategy*`,
      ``,
      `Amount: *${amount} SOL*`,
      ``,
      `Choose your range strategy:`,
      ``,
      `*Concentrated* → Higher fees, needs rebalancing`,
      `*Wide* → Lower fees, less maintenance`,
      `*Spot* → Single-sided entry`,
    ].join('\n'),
    buttons: [
      [
        { text: '🎯 Concentrated (±5 bins)', callback_data: `lpx:${poolAddress}:${amount}:c` },
      ],
      [
        { text: '📏 Wide (±20 bins)', callback_data: `lpx:${poolAddress}:${amount}:w` },
      ],
      [
        { text: '⚡ Spot (single-sided)', callback_data: `lpx:${poolAddress}:${amount}:s` },
      ],
      [
        { text: '❌ Cancel', callback_data: 'dismiss' },
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
  handlePools,
  handleLpAmountPrompt,
  handleLpStrategyPrompt,
};
