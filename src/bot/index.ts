/**
 * Bot initialization - grammY Bot instance with middleware and commands
 *
 * This sets up the grammY bot with:
 * - Session middleware for user state
 * - Conversations plugin for multi-step wizards
 * - Command handlers delegating to existing logic
 * - Callback query handling
 * - Error handling with bot.catch()
 *
 * The bot can run in webhook mode (production) or polling mode (development).
 * Webhook mode uses the Hono adapter from grammY.
 */
import { Bot, session, webhookCallback } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { BotContext, SessionData } from './types.js';
import {
  startCommand,
  balanceCommand,
  poolsCommand,
  positionsCommand,
  depositCommand,
  withdrawCommand,
  settingsCommand,
  helpCommand,
  portfolioCommand,
  statusCommand,
} from './commands/index.js';
import { handleCallback } from './callbacks.js';
import { lpWizard } from './conversations/lp-wizard.js';
import { withdrawWizard } from './conversations/withdraw-wizard.js';
import { rebalanceWizard } from './conversations/rebalance-wizard.js';
import { orcaLpWizard } from './conversations/orca-lp-wizard.js';
import { unifiedLpWizard } from './conversations/unified-lp-wizard.js';

let bot: Bot<BotContext> | null = null;

export function createBot(token?: string): Bot<BotContext> | null {
  const botToken = token || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.log('TELEGRAM_BOT_TOKEN not set, grammY bot disabled');
    return null;
  }

  bot = new Bot<BotContext>(botToken);

  // Session middleware (in-memory for conversations)
  bot.use(session({
    initial: (): SessionData => ({}),
  }));

  // Conversations plugin
  bot.use(conversations());
  bot.use(createConversation(lpWizard));
  bot.use(createConversation(withdrawWizard));
  bot.use(createConversation(rebalanceWizard));
  bot.use(createConversation(orcaLpWizard));
  bot.use(createConversation(unifiedLpWizard));

  // Register command handlers
  bot.command('start', startCommand);
  bot.command('balance', balanceCommand);
  bot.command('pools', poolsCommand);
  bot.command('positions', positionsCommand);
  bot.command('deposit', depositCommand);
  bot.command('withdraw', withdrawCommand);
  bot.command('settings', settingsCommand);
  bot.command('help', helpCommand);
  bot.command('portfolio', portfolioCommand);
  bot.command('status', statusCommand);

  // Conversation entry points (via commands)
  bot.command('lp', async (ctx) => {
    await ctx.conversation.enter('unifiedLpWizard');
  });
  bot.command('rebalance', async (ctx) => {
    await ctx.conversation.enter('rebalanceWizard');
  });

  // Callback queries (non-conversation callbacks handled here;
  // conversation callbacks are intercepted by the conversations plugin)
  bot.on('callback_query:data', handleCallback);

  // Text handler for pasted pool addresses (CA lookup)
  bot.on('message:text', async (ctx) => {
    const { consumeWaitingForCA } = await import('./types.js');
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (consumeWaitingForCA(chatId)) {
      const text = ctx.message.text.trim();
      // Basic Solana address validation (32-44 base58 chars)
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) {
        const { lookupPoolByAddress } = await import('./commands/pools.js');
        await lookupPoolByAddress(ctx, text);
      } else {
        await ctx.reply('Invalid address format. Please paste a valid Solana pool address, or use /pools to browse.');
      }
    }
  });

  // Error handler - never show raw errors to users
  bot.catch((err) => {
    const ctx = err.ctx;
    const e = err.error;
    console.error('[grammY Bot] Error handling update:', err.message);

    if (e instanceof Error) {
      console.error('[grammY Bot] Error details:', e.stack);
    }

    // Try to notify the user
    try {
      ctx.reply('Something went wrong. Please try again or use /help.').catch(() => {});
    } catch {
      // Ignore - we already logged the error
    }
  });

  console.log('grammY bot created');
  return bot;
}

/**
 * Initialize the bot (fetch bot info from Telegram API).
 * Must be called before handleUpdate() can process webhook updates.
 */
export async function initBot(): Promise<void> {
  if (!bot) return;
  await bot.init();
  console.log(`grammY bot initialized: @${bot.botInfo.username}`);
}

export function getBot(): Bot<BotContext> | null {
  return bot;
}

/**
 * Get webhook callback handler for Hono
 * This returns a handler function that processes Telegram webhook updates
 */
export function getBotWebhookHandler() {
  if (!bot) return null;
  return webhookCallback(bot, 'hono');
}

/**
 * Start bot in long polling mode (for development)
 */
export async function startPolling() {
  if (!bot) return;
  console.log('Starting grammY bot in polling mode...');
  await bot.start();
}

/**
 * Stop the bot gracefully
 */
export async function stopBot() {
  if (!bot) return;
  await bot.stop();
}

/**
 * Health check for Telegram bot connectivity.
 * Verifies:
 * - Bot is initialized
 * - Can reach Telegram API (getMe)
 * - Webhook status (if configured)
 */
export interface BotHealthCheck {
  healthy: boolean;
  initialized: boolean;
  username?: string;
  webhook?: {
    url: string;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
    has_custom_certificate: boolean;
  };
  error?: string;
  latencyMs?: number;
}

export async function checkBotHealth(): Promise<BotHealthCheck> {
  if (!bot) {
    return { healthy: false, initialized: false, error: 'Bot not created (TELEGRAM_BOT_TOKEN not set)' };
  }

  if (!bot.botInfo) {
    return { healthy: false, initialized: false, error: 'Bot not initialized (bot.init() not called)' };
  }

  const start = Date.now();
  
  try {
    // Verify API connectivity by calling getMe
    const me = await bot.api.getMe();
    const latencyMs = Date.now() - start;
    
    // Get webhook info
    const webhookInfo = await bot.api.getWebhookInfo();
    
    const result: BotHealthCheck = {
      healthy: true,
      initialized: true,
      username: me.username,
      latencyMs,
    };

    // Only include webhook info if configured
    if (webhookInfo.url) {
      result.webhook = {
        url: webhookInfo.url,
        pending_update_count: webhookInfo.pending_update_count,
        last_error_date: webhookInfo.last_error_date,
        last_error_message: webhookInfo.last_error_message,
        has_custom_certificate: webhookInfo.has_custom_certificate || false,
      };

      // Mark as unhealthy if webhook has recent errors
      if (webhookInfo.last_error_date && webhookInfo.last_error_message) {
        const errorAge = Date.now() / 1000 - webhookInfo.last_error_date;
        // Error in last 5 minutes = unhealthy
        if (errorAge < 300) {
          result.healthy = false;
          result.error = `Webhook error (${Math.round(errorAge)}s ago): ${webhookInfo.last_error_message}`;
        }
      }
    }

    return result;
  } catch (e) {
    return {
      healthy: false,
      initialized: true,
      username: bot.botInfo.username,
      error: `Telegram API error: ${(e as Error).message}`,
      latencyMs: Date.now() - start,
    };
  }
}

export type { BotContext, SessionData } from './types.js';
