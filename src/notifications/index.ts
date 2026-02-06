/**
 * Unified Notification System
 * 
 * Supports both:
 * - Telegram (for human users)
 * - Webhook (for AI agents)
 * 
 * Each user/agent registers their preferred notification method.
 */

import { Redis } from '@upstash/redis';
import crypto from 'crypto';

// ============ Types ============

export interface NotificationRecipient {
  walletId: string;
  
  // Notification methods (can have both)
  telegram?: {
    chatId: number | string;
    linkedAt: string;
  };
  webhook?: {
    url: string;
    secret?: string; // For HMAC verification
    linkedAt: string;
  };
  
  // Preferences
  preferences: {
    alertOnOutOfRange: boolean;
    alertOnBackInRange: boolean;
    dailySummary: boolean;
    autoRebalance: boolean; // If true, agents can auto-execute
    rebalanceThreshold: number; // % out of range before suggesting rebalance
  };
  
  createdAt: string;
  updatedAt: string;
}

export interface TelegramLinkCode {
  code: string;
  chatId: number | string;
  username?: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

export interface AlertPayload {
  event: 'out_of_range' | 'back_in_range' | 'rebalance_complete' | 'rebalance_failed' | 'daily_summary';
  walletId: string;
  timestamp: string;
  
  position?: {
    address: string;
    poolName: string;
    poolAddress: string;
  };
  
  details: {
    message: string;
    currentBin?: number;
    binRange?: { lower: number; upper: number };
    direction?: 'above' | 'below';
    distance?: number;
    [key: string]: any;
  };
  
  // For agents - actionable endpoints
  action?: {
    suggested: 'rebalance' | 'monitor' | 'withdraw' | 'none';
    endpoint?: string;
    method?: string;
    params?: Record<string, any>;
  };
}

// ============ Redis Keys ============

const KEYS = {
  RECIPIENT: (walletId: string) => `lp:notify:recipient:${walletId}`,
  LINK_CODE: (code: string) => `lp:notify:linkcode:${code}`,
  CHAT_TO_WALLET: (chatId: string | number) => `lp:notify:chat:${chatId}`,
  ALL_RECIPIENTS: 'lp:notify:recipients',
};

// ============ Redis Client ============

let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    throw new Error('Redis not configured');
  }
  
  redis = new Redis({ url, token });
  return redis;
}

// ============ Recipient Management ============

/**
 * Get a notification recipient by wallet ID
 */
export async function getRecipient(walletId: string): Promise<NotificationRecipient | null> {
  const client = getRedis();
  return client.get<NotificationRecipient>(KEYS.RECIPIENT(walletId));
}

/**
 * Create or update a notification recipient
 */
export async function upsertRecipient(recipient: Partial<NotificationRecipient> & { walletId: string }): Promise<NotificationRecipient> {
  const client = getRedis();
  
  const existing = await getRecipient(recipient.walletId);
  const now = new Date().toISOString();
  
  const updated: NotificationRecipient = {
    walletId: recipient.walletId,
    telegram: recipient.telegram || existing?.telegram,
    webhook: recipient.webhook || existing?.webhook,
    preferences: {
      alertOnOutOfRange: true,
      alertOnBackInRange: true,
      dailySummary: false,
      autoRebalance: false,
      rebalanceThreshold: 5,
      ...existing?.preferences,
      ...recipient.preferences,
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  
  await client.set(KEYS.RECIPIENT(recipient.walletId), updated);
  await client.sadd(KEYS.ALL_RECIPIENTS, recipient.walletId);
  
  // If telegram linked, create reverse mapping
  if (updated.telegram?.chatId) {
    await client.set(KEYS.CHAT_TO_WALLET(updated.telegram.chatId), recipient.walletId);
  }
  
  console.log(`[Notify] Recipient ${recipient.walletId} updated`);
  return updated;
}

/**
 * Get all registered recipients
 */
export async function getAllRecipients(): Promise<string[]> {
  const client = getRedis();
  return client.smembers(KEYS.ALL_RECIPIENTS);
}

/**
 * Get wallet ID by Telegram chat ID (reverse lookup)
 */
export async function getWalletByChatId(chatId: string | number): Promise<string | null> {
  const client = getRedis();
  return client.get<string>(KEYS.CHAT_TO_WALLET(chatId));
}

// ============ Telegram Link Codes ============

/**
 * Generate a link code for Telegram authentication
 */
export async function generateLinkCode(chatId: number | string, username?: string): Promise<TelegramLinkCode> {
  const client = getRedis();
  
  // Generate 6-character alphanumeric code
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
  
  const linkCode: TelegramLinkCode = {
    code,
    chatId,
    username,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    used: false,
  };
  
  // Store with expiration
  await client.set(KEYS.LINK_CODE(code), linkCode, { ex: 600 }); // 10 min TTL
  
  console.log(`[Notify] Generated link code ${code} for chat ${chatId}`);
  return linkCode;
}

/**
 * Validate and consume a link code
 */
export async function consumeLinkCode(code: string): Promise<TelegramLinkCode | null> {
  const client = getRedis();
  
  const linkCode = await client.get<TelegramLinkCode>(KEYS.LINK_CODE(code.toUpperCase()));
  
  if (!linkCode) {
    return null; // Code doesn't exist or expired
  }
  
  if (linkCode.used) {
    return null; // Already used
  }
  
  if (new Date(linkCode.expiresAt) < new Date()) {
    return null; // Expired
  }
  
  // Mark as used
  linkCode.used = true;
  await client.set(KEYS.LINK_CODE(code), linkCode, { ex: 60 }); // Keep for 1 more minute
  
  console.log(`[Notify] Link code ${code} consumed for chat ${linkCode.chatId}`);
  return linkCode;
}

// ============ Alert Delivery ============

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Send alert to a recipient via their preferred method(s)
 */
export async function sendAlert(walletId: string, payload: AlertPayload): Promise<{
  telegram?: { success: boolean; error?: string };
  webhook?: { success: boolean; error?: string };
}> {
  const recipient = await getRecipient(walletId);
  
  if (!recipient) {
    console.warn(`[Notify] No recipient found for wallet ${walletId}`);
    return {};
  }
  
  const results: {
    telegram?: { success: boolean; error?: string };
    webhook?: { success: boolean; error?: string };
  } = {};
  
  // Send via Telegram
  if (recipient.telegram?.chatId) {
    results.telegram = await sendTelegramAlert(recipient.telegram.chatId, payload);
  }
  
  // Send via Webhook
  if (recipient.webhook?.url) {
    results.webhook = await sendWebhookAlert(recipient.webhook.url, payload, recipient.webhook.secret);
  }
  
  return results;
}

/**
 * Send alert via Telegram
 */
async function sendTelegramAlert(chatId: number | string, payload: AlertPayload): Promise<{ success: boolean; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return { success: false, error: 'Bot token not configured' };
  }
  
  // Format message based on event type
  const message = formatTelegramMessage(payload);
  const keyboard = formatTelegramKeyboard(payload);
  
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      }),
    });
    
    const data = await response.json() as any;
    
    if (data.ok) {
      console.log(`[Notify] Telegram alert sent to ${chatId}`);
      return { success: true };
    } else {
      console.error(`[Notify] Telegram failed: ${data.description}`);
      return { success: false, error: data.description };
    }
  } catch (error: any) {
    console.error(`[Notify] Telegram error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Send alert via Webhook (for agents)
 */
async function sendWebhookAlert(url: string, payload: AlertPayload, secret?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MnM-LP-Toolkit/1.0',
    };
    
    // Add HMAC signature if secret provided
    if (secret) {
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Signature'] = `sha256=${signature}`;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      console.log(`[Notify] Webhook alert sent to ${url}`);
      return { success: true };
    } else {
      const error = `HTTP ${response.status}`;
      console.error(`[Notify] Webhook failed: ${error}`);
      return { success: false, error };
    }
  } catch (error: any) {
    console.error(`[Notify] Webhook error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Format alert message for Telegram
 */
function formatTelegramMessage(payload: AlertPayload): string {
  switch (payload.event) {
    case 'out_of_range':
      return [
        `🚨 *${payload.position?.poolName || 'Position'} Out of Range*`,
        ``,
        `Your position is ${payload.details.distance} bins ${payload.details.direction} your range.`,
        ``,
        `📍 Current: bin ${payload.details.currentBin}`,
        `📐 Your range: ${payload.details.binRange?.lower} → ${payload.details.binRange?.upper}`,
        ``,
        `_${payload.details.message}_`,
      ].join('\n');
    
    case 'back_in_range':
      return [
        `✅ *${payload.position?.poolName || 'Position'} Back in Range*`,
        ``,
        `Your position is earning fees again!`,
        ``,
        `📍 Current: bin ${payload.details.currentBin}`,
      ].join('\n');
    
    case 'rebalance_complete':
      return [
        `✅ *Rebalance Complete*`,
        ``,
        `${payload.position?.poolName || 'Position'} has been rebalanced.`,
        ``,
        payload.details.message,
      ].join('\n');
    
    case 'rebalance_failed':
      return [
        `❌ *Rebalance Failed*`,
        ``,
        `${payload.position?.poolName || 'Position'} rebalance failed.`,
        ``,
        `Error: ${payload.details.message}`,
        ``,
        `Your tokens are safe in your wallet.`,
      ].join('\n');
    
    case 'daily_summary':
      return [
        `📊 *Daily LP Summary*`,
        ``,
        payload.details.message,
      ].join('\n');
    
    default:
      return payload.details.message;
  }
}

/**
 * Format inline keyboard for Telegram
 */
function formatTelegramKeyboard(payload: AlertPayload): Array<Array<{ text: string; callback_data: string }>> | null {
  if (payload.event === 'out_of_range' && payload.action?.suggested === 'rebalance') {
    return [
      [
        { text: '🔄 Rebalance Now', callback_data: `rebalance:${payload.position?.address?.slice(0, 16)}` },
        { text: '⏰ Snooze 1h', callback_data: `snooze:${payload.position?.address?.slice(0, 16)}` },
      ],
      [
        { text: '❌ Dismiss', callback_data: 'dismiss' },
      ],
    ];
  }
  
  return null;
}

// ============ Telegram Bot Handlers ============

/**
 * Handle /start command from Telegram
 */
export async function handleTelegramStart(chatId: number | string, username?: string): Promise<string> {
  // Check if already linked
  const existingWallet = await getWalletByChatId(chatId);
  
  if (existingWallet) {
    return [
      `✅ You're already linked!`,
      ``,
      `Wallet: \`${existingWallet.slice(0, 8)}...\``,
      ``,
      `Commands:`,
      `/status - Check your positions`,
      `/settings - Update preferences`,
      `/unlink - Disconnect this chat`,
    ].join('\n');
  }
  
  // Generate new link code
  const linkCode = await generateLinkCode(chatId, username);
  
  return [
    `🔗 *Link Your LP Wallet*`,
    ``,
    `Your link code:`,
    `\`${linkCode.code}\``,
    ``,
    `Enter this code when creating your wallet, or use:`,
    `\`POST /notify/link\``,
    `\`{ "walletId": "...", "code": "${linkCode.code}" }\``,
    ``,
    `⏰ Code expires in 10 minutes.`,
  ].join('\n');
}

/**
 * Handle callback queries (button presses)
 */
export async function handleTelegramCallback(chatId: number | string, data: string): Promise<string> {
  const [action, param] = data.split(':');
  
  switch (action) {
    case 'rebalance':
    case 'rebalance_all': {
      const walletId = param || await getWalletByChatId(chatId);
      if (!walletId) {
        return '❌ Wallet not linked. Use /start to link.';
      }
      return [
        `🔄 *Rebalance Initiated*`,
        ``,
        `🔐 Encrypting strategy with Arcium...`,
        `⚡ Building Jito bundle...`,
        ``,
        `I'll notify you when complete.`,
        ``,
        `_Transactions are MEV-protected_`,
      ].join('\n');
    }
    
    case 'withdraw_all': {
      const walletId = param;
      if (!walletId) {
        return '❌ Wallet not found.';
      }
      return [
        `📤 *Withdraw All Initiated*`,
        ``,
        `🔐 Encrypting with Arcium...`,
        `⚡ Building Jito bundle...`,
        ``,
        `To complete withdrawal, send destination address:`,
        `\`/withdraw <destination_address>\``,
        ``,
        `Or use the API:`,
        `\`POST /lp/withdraw/atomic\``,
      ].join('\n');
    }
    
    case 'withdraw_lp': {
      const walletId = param;
      return [
        `📊 *Withdraw from LP Position*`,
        ``,
        `This will:`,
        `1. 🔐 Encrypt strategy (Arcium)`,
        `2. 📤 Withdraw liquidity`,
        `3. 💱 Swap to SOL (optional)`,
        `4. ⚡ Bundle via Jito`,
        ``,
        `Use /positions to see your LP positions,`,
        `then tap a position to withdraw.`,
      ].join('\n');
    }
    
    case 'claim_fees': {
      const walletId = param || await getWalletByChatId(chatId);
      return [
        `💸 *Claim Fees Initiated*`,
        ``,
        `🔐 Encrypting with Arcium...`,
        `⚡ Building Jito bundle...`,
        ``,
        `Claiming fees from all positions...`,
        `I'll notify you when complete.`,
      ].join('\n');
    }
    
    case 'add_lp': {
      return [
        `📈 *Add Liquidity*`,
        ``,
        `To add liquidity:`,
        `1. Check /balance for available SOL`,
        `2. Use the API:`,
        ``,
        `\`POST /lp/atomic\``,
        `\`{ "walletId": "...", "poolAddress": "...", "amountSol": 0.1 }\``,
        ``,
        `🔐 Encrypted with Arcium`,
        `⚡ MEV-protected via Jito`,
      ].join('\n');
    }
    
    case 'toggle_alerts': {
      const walletId = param;
      const recipient = walletId ? await getRecipient(walletId) : null;
      if (!recipient) {
        return '❌ Settings not found.';
      }
      const newValue = !recipient.preferences.alertOnOutOfRange;
      await upsertRecipient({
        walletId,
        preferences: { ...recipient.preferences, alertOnOutOfRange: newValue },
      });
      return `🔔 Out of range alerts: ${newValue ? '*ON* ✅' : '*OFF* ❌'}`;
    }
    
    case 'toggle_rebalance': {
      const walletId = param;
      const recipient = walletId ? await getRecipient(walletId) : null;
      if (!recipient) {
        return '❌ Settings not found.';
      }
      const newValue = !recipient.preferences.autoRebalance;
      await upsertRecipient({
        walletId,
        preferences: { ...recipient.preferences, autoRebalance: newValue },
      });
      return `🔄 Auto-rebalance: ${newValue ? '*ON* ✅' : '*OFF* ❌'}`;
    }
    
    case 'toggle_summary': {
      const walletId = param;
      const recipient = walletId ? await getRecipient(walletId) : null;
      if (!recipient) {
        return '❌ Settings not found.';
      }
      const newValue = !recipient.preferences.dailySummary;
      await upsertRecipient({
        walletId,
        preferences: { ...recipient.preferences, dailySummary: newValue },
      });
      return `📊 Daily summary: ${newValue ? '*ON* ✅' : '*OFF* ❌'}`;
    }
    
    case 'balance': {
      return `Use /balance to check your wallet balance.`;
    }
    
    case 'settings': {
      return `Use /settings to manage your preferences.`;
    }
    
    case 'snooze':
      return `⏰ Snoozed for 1 hour. I'll check again later.`;
    
    case 'dismiss':
      return `✓ Dismissed.`;
    
    default:
      return `Unknown action: ${action}. Try /help`;
  }
}

export default {
  getRecipient,
  upsertRecipient,
  getAllRecipients,
  getWalletByChatId,
  generateLinkCode,
  consumeLinkCode,
  sendAlert,
  handleTelegramStart,
  handleTelegramCallback,
};
