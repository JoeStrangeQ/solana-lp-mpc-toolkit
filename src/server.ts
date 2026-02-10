/**
 * LP Agent API Server - Modular Architecture
 *
 * Clean entry point that wires together:
 * - Hono HTTP routes (from src/routes/)
 * - grammY Telegram bot (from src/bot/)
 * - Background monitoring system
 * - Keep-alive for Railway
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { stats } from './services/stats.js';
import { FEE_CONFIG } from './services/pool-service.js';

// Import route modules
import {
  healthRoutes,
  walletRoutes,
  poolRoutes,
  positionRoutes,
  positionsByAddress,
  lpRoutes,
  withdrawRoutes,
  feeRoutes,
  rebalanceRoutes,
  swapRoutes,
  encryptRoutes,
  monitorRoutes,
  workerRoutes,
  userRoutes,
  alertRoutes,
  riskRoutes,
  notifyRoutes,
  telegramRoutes,
  chatRoutes,
  portfolioRoutes,
  initializeMonitoring,
  startMonitoringInterval,
} from './routes/index.js';
import skillRoutes from './routes/skill.js';
import oracleRoutes from './routes/oracle.js';
import ultraSwapRoutes from './routes/ultra-swap.js';
import actionsRoutes from './routes/actions.js';
import unifiedLpRoutes from './routes/unified-lp.js';
import raydiumRoutes from './routes/raydium.js';

// Import bot
import { createBot, initBot, getBot, getBotWebhookHandler } from './bot/index.js';

// Import middleware
import { requestIdMiddleware } from './middleware/requestId.js';

// Import worker
import { startWorker, isWorkerRunning } from './monitoring/index.js';

// ============ Create App ============

const app = new Hono();

// Global middleware
app.use('*', cors());

// Request ID middleware - generates unique ID for each request, logs timing
app.use('*', requestIdMiddleware);

// Stats tracking middleware
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const hour = new Date().toISOString().slice(0, 13);

  stats.requests.total++;
  stats.requests.byEndpoint[path] = (stats.requests.byEndpoint[path] || 0) + 1;
  stats.requests.byHour[hour] = (stats.requests.byHour[hour] || 0) + 1;
  stats.lastRequest = new Date().toISOString();

  await next();
});

// ============ Mount Routes ============

// Health & info (root level)
app.route('/', healthRoutes);

// Core API routes
app.route('/wallet', walletRoutes);
app.route('/pools', poolRoutes);
app.route('/positions', positionRoutes);
// Also mount query-by-address at /positions (GET with ?address= param)
app.route('/positions', positionsByAddress());
app.route('/lp', lpRoutes);
app.route('/lp/withdraw', withdrawRoutes);
app.route('/lp/rebalance', rebalanceRoutes);
app.route('/unified', unifiedLpRoutes);
app.route('/swap', swapRoutes);
app.route('/encrypt', encryptRoutes);

// Fee routes
app.route('/fees', feeRoutes());
// Also mount basic fee info at /fees
app.get('/fees', (c) => c.json({
  protocolFee: {
    bps: FEE_CONFIG.FEE_BPS,
    percentage: `${FEE_CONFIG.FEE_BPS / 100}%`,
    description: 'Fee deducted from every LP transaction',
  },
  treasury: FEE_CONFIG.TREASURY,
  minFee: { lamports: FEE_CONFIG.MIN_FEE_LAMPORTS },
  exemptThreshold: { usd: FEE_CONFIG.EXEMPT_THRESHOLD_USD },
}));

app.get('/fees/calculate', (c) => {
  const amount = parseFloat(c.req.query('amount') || '0');
  if (amount <= 0) {
    return c.json({ error: 'Provide a positive amount' }, 400);
  }
  const fee = (amount * FEE_CONFIG.FEE_BPS) / 10000;
  return c.json({
    input: amount,
    fee: { bps: FEE_CONFIG.FEE_BPS, amount: fee },
    output: amount - fee,
  });
});

// Monitoring routes
app.route('/monitor', monitorRoutes);
app.route('/worker', workerRoutes());
app.route('/user', userRoutes());
app.route('/alerts', alertRoutes());
app.route('/risk', riskRoutes());

// Notification & Telegram routes
app.route('/', notifyRoutes);
app.route('/telegram', telegramRoutes());

// Chat interface
app.route('/chat', chatRoutes);

// Skill file
app.route('/skill.md', skillRoutes);

// Oracle & Ultra Swap routes
app.route('/oracle', oracleRoutes);
app.route('/ultra', ultraSwapRoutes);

// Raydium CLMM routes
app.route('/raydium', raydiumRoutes);

// Portfolio routes (aggregated across all DEXes)
app.route('/portfolio', portfolioRoutes);

// Solana Actions & Blinks
app.route('/', actionsRoutes);

// Debug Jupiter test
app.get('/debug/jupiter-test', async (c) => {
  const jupiterApiKey = process.env.JUPITER_API_KEY;
  const testUrl = 'https://api.jup.ag/swap/v1/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=100';

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (jupiterApiKey) {
    headers['x-api-key'] = jupiterApiKey;
  }

  try {
    const startTime = Date.now();
    const response = await fetch(testUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const elapsed = Date.now() - startTime;
    const body = await response.text();

    return c.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: elapsed,
      apiKeyPresent: !!jupiterApiKey,
      responsePreview: body.slice(0, 500),
    });
  } catch (e: any) {
    return c.json({
      success: false,
      error: e?.message || String(e),
      errorCode: e?.cause?.code || e?.code,
      errorCause: e?.cause?.message,
      apiKeyPresent: !!jupiterApiKey,
    });
  }
});

// ============ grammY Bot Webhook ============

// Mount the grammY webhook handler for Telegram updates.
// This replaces the legacy /telegram/webhook route with native grammY handling.
// The bot must be created first (in start()), so the handler is mounted lazily.
app.post('/bot/webhook', async (c) => {
  const bot = getBot();
  if (!bot) {
    return c.json({ error: 'Bot not initialized' }, 503);
  }
  try {
    const body = await c.req.json();
    const msgText = body?.message?.text || body?.callback_query?.data || 'unknown';
    const chatId = body?.message?.chat?.id || body?.callback_query?.message?.chat?.id || 'unknown';
    console.log(`[Bot Webhook] update: chat=${chatId} "${msgText}"`);
    await bot.handleUpdate(body);
    return c.json({ ok: true });
  } catch (err: any) {
    console.error('[Bot Webhook] Error:', err?.message || err);
    return c.json({ ok: true });
  }
});

// ============ Initialize & Start ============

async function start() {
  // Initialize monitoring system
  await initializeMonitoring();
  // DISABLED: Worker in monitoring/worker.ts handles monitoring with unified notifications
  // startMonitoringInterval() only supports webhook delivery - worker supports Telegram + webhook
  // startMonitoringInterval();

  // Initialize grammY bot (creates instance, fetches botInfo from Telegram API)
  createBot();
  await initBot();

  // Keep-alive self-ping for Railway
  const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
  const selfPing = async () => {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (!domain) return;
    try {
      const response = await fetch(`https://${domain}/health`);
      if (response.ok) {
        console.log('[KeepAlive] Ping successful');
      }
    } catch (e) {
      console.warn('[KeepAlive] Ping failed:', (e as Error).message);
    }
  };

  setTimeout(() => {
    setInterval(selfPing, KEEPALIVE_INTERVAL_MS);
    console.log(`Keep-alive enabled (interval: ${KEEPALIVE_INTERVAL_MS / 1000}s)`);
  }, 60000);

  // Auto-start worker
  startWorker().catch(err => {
    console.error('Failed to start worker:', err);
  });

  // Start HTTP server
  const port = parseInt(process.env.PORT || '3456');
  console.log(`LP Agent Toolkit - Starting on port ${port}...`);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Server running on http://0.0.0.0:${info.port}`);
    console.log(`Worker status: ${isWorkerRunning() ? 'RUNNING' : 'STOPPED'}`);
  });
}

start();

// Export app for testing
export { app };
// Build: 1770503815
