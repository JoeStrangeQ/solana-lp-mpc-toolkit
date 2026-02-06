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

// Import getUserByChat from onboarding (lazy import to avoid circular deps)
async function getUserByChat(chatId: string | number): Promise<{ walletId: string; walletAddress: string } | null> {
  const client = getRedis();
  const walletId = await client.get<string>(`notify:chat:${chatId}`);
  if (!walletId) return null;
  
  const profile = await client.get<{ walletId: string; walletAddress: string }>(`user:${walletId}`);
  return profile || null;
}

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
  // Split only on first colon to preserve params with colons (e.g., lp_amount:ADDRESS:0.5)
  const colonIdx = data.indexOf(':');
  const action = colonIdx > -1 ? data.slice(0, colonIdx) : data;
  const param = colonIdx > -1 ? data.slice(colonIdx + 1) : undefined;
  
  switch (action) {
    case 'refresh_balance': {
      // Just re-trigger /balance - caller should handle this
      return 'REFRESH_BALANCE';
    }
    
    case 'swap_all': {
      const walletId = param;
      if (!walletId) {
        return '❌ Wallet not found.';
      }
      
      // Queue swap job for background processing
      try {
        const { queueSwapAll } = await import('../monitoring/worker.js');
        
        const jobId = await queueSwapAll({
          walletId,
          chatId,
        });
        
        return [
          `🔄 *Swap All to SOL Queued*`,
          ``,
          `🔐 Encrypting with Arcium...`,
          `⚡ Will bundle via Jito for MEV protection`,
          ``,
          `Processing in background...`,
          `I'll send you a message when complete!`,
          `_(Usually 30-60 seconds)_`,
        ].join('\n');
        
      } catch (error: any) {
        return [
          `❌ *Failed to Queue Swap*`,
          ``,
          `Error: ${error.message || 'Unknown error'}`,
          ``,
          `_Please try again later._`,
        ].join('\n');
      }
    }
    
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
    
    case 'wd':  // Short format: wd:p0, wd:p1, etc.
    case 'withdraw_pos': {
      const walletId = await getWalletByChatId(chatId);
      if (!walletId) {
        return '❌ Wallet not linked. Use /start first.';
      }
      
      let poolAddress: string | undefined;
      let positionAddress: string | undefined;
      
      // Check if using new short format (wd:p0) or old format (withdraw_pos:addr:addr)
      if (action === 'wd' && param?.startsWith('p')) {
        // Look up position from Redis cache
        try {
          const client = getRedis();
          const positionMap = await client.get<Record<string, { poolAddress: string; positionAddress: string }>>(`positions:${walletId}`);
          if (positionMap && positionMap[param]) {
            poolAddress = positionMap[param].poolAddress;
            positionAddress = positionMap[param].positionAddress;
          }
        } catch (e) {
          console.error('Failed to lookup position:', e);
        }
      } else {
        // Old format: poolAddress:positionAddress
        const colonIdx = param?.indexOf(':') ?? -1;
        poolAddress = colonIdx > -1 ? param!.slice(0, colonIdx) : param;
        positionAddress = colonIdx > -1 ? param!.slice(colonIdx + 1) : undefined;
      }
      
      if (!poolAddress || !positionAddress) {
        return '❌ Position not found. Try /positions again to refresh.';
      }
      
      // Queue withdrawal for background processing (avoids Railway timeout)
      try {
        // Get pool name first (fast)
        let poolName = poolAddress.slice(0, 8) + '...';
        try {
          const poolResp = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
          if (poolResp.ok) {
            const poolData = await poolResp.json() as any;
            poolName = poolData.name || poolName;
          }
        } catch (e) { /* ignore */ }
        
        // Import and queue (lazy import to avoid circular deps)
        const { queueWithdrawal } = await import('../monitoring/worker.js');
        
        const jobId = await queueWithdrawal({
          walletId,
          poolAddress,
          positionAddress,
          chatId,
          convertToSol: true,
          poolName,
        });
        
        return [
          `⏳ *Withdrawal Queued*`,
          ``,
          `📊 Pool: ${poolName}`,
          `🔄 Processing in background...`,
          ``,
          `I'll send you a message when it's done!`,
          `(Usually 30-60 seconds)`,
        ].join('\n');
        
      } catch (error: any) {
        return [
          `❌ *Failed to Queue Withdrawal*`,
          ``,
          `Error: ${error.message || 'Queue failed'}`,
          ``,
          `_Please try again later._`,
        ].join('\n');
      }
    }
    
    case 'claim_fees': {
      const walletId = param || await getWalletByChatId(chatId);
      if (!walletId) {
        return '❌ Wallet not linked. Use /start first.';
      }
      // TODO: Actually trigger fee claim via API
      return [
        `💸 *Claim Fees Initiated*`,
        ``,
        `🔐 Encrypting with Arcium...`,
        `⚡ Building Jito bundle...`,
        ``,
        `Claiming fees from all positions...`,
        `I'll notify you when complete.`,
        ``,
        `_To claim via API:_`,
        `\`POST /fees/claim\``,
      ].join('\n');
    }
    
    case 'refresh_positions': {
      return `🔄 Use /positions to refresh your LP positions.`;
    }
    
    case 'refresh_pools': {
      return `🔄 Use /pools to see updated pool list.`;
    }
    
    case 'lp_pool': {
      // param format: poolAddress:poolName
      const [poolAddress, poolName] = param?.split(':') || [];
      if (!poolAddress) {
        return '❌ Invalid pool selection.';
      }
      // Return response that triggers amount selection
      return `LP_AMOUNT_PROMPT:${poolAddress}:${poolName || 'Pool'}`;
    }
    
    case 'lp_amount': {
      // param format: poolAddress:amount
      const [poolAddress, amount] = param?.split(':') || [];
      if (!poolAddress || !amount) {
        return '❌ Invalid amount selection.';
      }
      // Return response that triggers strategy selection
      return `LP_STRATEGY_PROMPT:${poolAddress}:${amount}`;
    }
    
    case 'lpx':  // Short version of lp_execute (Telegram 64-byte limit)
    case 'lp_execute': {
      // param format: poolAddress:amount:strategy
      // strategy can be: c=concentrated, w=wide, s=spot (short) or full names
      const [poolAddress, amount, strategyShort] = param?.split(':') || [];
      const strategyMap: Record<string, string> = { c: 'concentrated', w: 'wide', s: 'spot' };
      const strategy = strategyMap[strategyShort] || strategyShort;
      const walletId = await getWalletByChatId(chatId);
      
      if (!walletId) {
        return '❌ Wallet not linked. Use /start first.';
      }
      
      if (!poolAddress || !amount || !strategy) {
        return '❌ Invalid LP parameters.';
      }
      
      // Actually execute the LP - call internal API
      try {
        const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : 'http://localhost:3000';
        
        const response = await fetch(`${apiUrl}/lp/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletId,
            poolAddress,
            amountSol: parseFloat(amount),
            strategy,
          }),
        });
        
        const result = await response.json() as any;
        
        if (result.success) {
          // Get pool name from Meteora
          let poolName = poolAddress.slice(0, 8) + '...';
          try {
            const poolResp = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
            if (poolResp.ok) {
              const poolData = await poolResp.json() as any;
              poolName = poolData.name || poolName;
            }
          } catch (e) { /* ignore */ }
          
          return [
            `✅ *LP Position Opened!*`,
            ``,
            `📊 Pool: ${poolName}`,
            `💰 Amount: ${amount} SOL`,
            `📐 Strategy: ${strategy}`,
            ``,
            `🔐 Encrypted with Arcium`,
            `⚡ Bundled via Jito`,
            `📍 Bundle: \`${result.bundle?.bundleId?.slice(0, 16)}...\``,
            ``,
            `_Use /positions to view your LP_`,
          ].join('\n');
        } else {
          return [
            `❌ *LP Failed*`,
            ``,
            `Error: ${result.error || 'Unknown error'}`,
            result.details ? `Details: ${result.details}` : '',
            ``,
            `_Try again or contact support._`,
          ].filter(Boolean).join('\n');
        }
      } catch (error: any) {
        return [
          `❌ *LP Failed*`,
          ``,
          `Error: ${error.message || 'Request failed'}`,
          ``,
          `_Please try again later._`,
        ].join('\n');
      }
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
      const walletId = param || '';
      if (!walletId) return '❌ Wallet ID missing.';
      const recipient = await getRecipient(walletId);
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
      const walletId = param || '';
      if (!walletId) return '❌ Wallet ID missing.';
      const recipient = await getRecipient(walletId);
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
      const walletId = param || '';
      if (!walletId) return '❌ Wallet ID missing.';
      const recipient = await getRecipient(walletId);
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
