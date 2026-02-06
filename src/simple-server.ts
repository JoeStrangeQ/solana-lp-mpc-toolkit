/**
 * LP Agent API Server - Full Railway Version
 * Includes: health, fees, pools, encrypt, wallet, LP, rebalance
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { arciumPrivacy } from './privacy';
import { config } from './config';
import { MeteoraDirectClient } from './dex/meteora';
import DLMM from '@meteora-ag/dlmm';
import { resolveTokens, binIdToPrice, calculatePriceRange, calculateHumanPriceRange, formatPriceRange, formatPrice } from './utils/token-metadata';
import { discoverAllPositions, getPositionBinRange, getPoolInfo } from './utils/position-discovery';
import { buildAtomicLP } from './lp/atomic';
import { buildAtomicWithdraw } from './lp/atomicWithdraw';
import { executeRebalance } from './lp/atomicRebalance';
import { sendBundle, waitForBundle, TipSpeed } from './jito';
import {
  getPositionMonitor,
  setWebhookConfig,
  getWebhookConfig,
  deliverAlerts,
  testWebhook,
  loadData,
  addPosition as persistAddPosition,
  removePosition as persistRemovePosition,
  setWebhook as persistSetWebhook,
  setLastCheck,
  getLastCheck,
  getStorageInfo,
  isRedisAvailable,
  type MonitoredPosition,
  type WebhookConfig,
  type AlertResult,
} from './monitoring/index.js';

// Lazy-load Privy to avoid ESM/CJS issues at startup
let PrivyWalletClient: any = null;
async function loadPrivy() {
  if (!PrivyWalletClient) {
    try {
      const module = await import('./mpc/privyClient.js');
      PrivyWalletClient = module.PrivyWalletClient;
    } catch (e) {
      console.warn('⚠️ Privy SDK failed to load (ESM issue):', (e as Error).message);
    }
  }
  return PrivyWalletClient;
}

const app = new Hono();

// ============ Usage Stats (in-memory) ============
const stats = {
  startedAt: new Date().toISOString(),
  requests: {
    total: 0,
    byEndpoint: {} as Record<string, number>,
    byHour: {} as Record<string, number>,
  },
  actions: {
    walletsCreated: 0,
    walletsLoaded: 0,
    transfers: 0,
    lpExecuted: 0,
    lpWithdrawn: 0,
    encryptions: 0,
  },
  errors: 0,
  lastRequest: null as string | null,
};

// ============ Monitoring State ============
const monitoringState = {
  enabled: true,
  lastCheck: null as string | null,
  intervalId: null as NodeJS.Timeout | null,
};

// Middleware
app.use('*', cors());

// Stats tracking middleware
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH

  stats.requests.total++;
  stats.requests.byEndpoint[path] = (stats.requests.byEndpoint[path] || 0) + 1;
  stats.requests.byHour[hour] = (stats.requests.byHour[hour] || 0) + 1;
  stats.lastRequest = new Date().toISOString();

  await next();
});

// Connection (stateless - just RPC)
let connection: Connection;
try {
  connection = new Connection(config.solana.rpc || 'https://api.mainnet-beta.solana.com');
  console.log('✅ Solana connection initialized');
} catch (e) {
  console.warn('⚠️ Solana connection failed, using fallback');
  connection = new Connection('https://api.mainnet-beta.solana.com');
}

// ============ Position Monitor Initialization ============
const monitor = getPositionMonitor(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');

// Load persisted data on startup
async function initializeMonitoring() {
  try {
    const storageInfo = getStorageInfo();
    console.log(`[Persistence] Storage type: ${storageInfo.type} (available: ${storageInfo.available})`);
    
    const data = await loadData();

    // Restore positions to monitor
    for (const position of data.positions) {
      monitor.addPosition(position);
    }

    // Restore webhook config
    if (data.webhook) {
      setWebhookConfig(data.webhook);
    }

    // Restore last check timestamp
    if (data.lastCheck) {
      monitoringState.lastCheck = data.lastCheck;
    }

    console.log(`✅ Monitoring initialized: ${data.positions.length} positions, webhook: ${data.webhook ? 'configured' : 'none'}`);
  } catch (e) {
    console.warn('⚠️ Failed to initialize monitoring:', (e as Error).message);
  }
}

// Run monitoring check
async function runMonitoringCheck(): Promise<AlertResult[]> {
  console.log('[Monitor] Running scheduled check...');
  const now = new Date().toISOString();

  try {
    const alerts = await monitor.checkAllPositions();
    monitoringState.lastCheck = now;
    await setLastCheck(now);

    if (alerts.length > 0) {
      console.log(`[Monitor] Found ${alerts.length} alerts, delivering to webhook...`);
      const results = await deliverAlerts(alerts);
      const successful = results.filter(r => r.success).length;
      console.log(`[Monitor] Delivered ${successful}/${alerts.length} alerts`);
    } else {
      console.log('[Monitor] No alerts');
    }

    return alerts;
  } catch (e) {
    console.error('[Monitor] Check failed:', (e as Error).message);
    return [];
  }
}

// Initialize on startup
initializeMonitoring();

// Background polling setup
const MONITOR_INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '300000'); // Default 5 min
if (MONITOR_INTERVAL_MS > 0) {
  console.log(`✅ Background monitoring enabled (interval: ${MONITOR_INTERVAL_MS}ms)`);
  monitoringState.intervalId = setInterval(runMonitoringCheck, MONITOR_INTERVAL_MS);
} else {
  console.log('ℹ️ Background monitoring disabled (MONITOR_INTERVAL_MS=0)');
  monitoringState.enabled = false;
}

// Stateless Privy helpers - load wallet fresh per request
async function createPrivyClient() {
  if (!config.privy?.appId || !config.privy?.appSecret) {
    return null;
  }

  const Client = await loadPrivy();
  if (!Client) return null;

  try {
    return new Client({
      appId: config.privy.appId,
      appSecret: config.privy.appSecret,
      authorizationPrivateKey: config.privy.authorizationPrivateKey || undefined,
    });
  } catch (e) {
    console.warn('⚠️ Privy client creation failed:', (e as Error).message);
    return null;
  }
}

// Load wallet by ID - stateless, fresh each request
async function loadWalletById(walletId: string) {
  const client = await createPrivyClient();
  if (!client) {
    throw new Error('Privy not configured');
  }
  const wallet = await client.loadWallet(walletId);
  return { client, wallet };
}

// Fee config
const FEE_CONFIG = {
  FEE_BPS: 10, // 0.1%
  TREASURY: 'fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt',
  MIN_FEE_LAMPORTS: 10000,
  EXEMPT_THRESHOLD_USD: 1,
};

// Sample pools
const SAMPLE_POOLS = [
  {
    address: 'BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE',
    name: 'SOL-USDC',
    dex: 'meteora',
    tokens: ['SOL', 'USDC'],
    tvl: 4800000,
    apy: 42.5,
    volume24h: 1250000,
    binStep: 4,
  },
  {
    address: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq',
    name: 'SOL-USDC',
    dex: 'meteora',
    tokens: ['SOL', 'USDC'],
    tvl: 2100000,
    apy: 38.2,
    volume24h: 890000,
    binStep: 2,
  },
];

// ============ Routes ============

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '2.4.0-redis-persistence',
  status: 'running',
  docs: 'https://mnm-web-seven.vercel.app',
  github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  features: ['MPC Custody', 'Arcium Privacy', 'Stateless API', 'Multi-DEX LP', 'Position Monitoring', 'Webhook Alerts', 'Redis Persistence'],
  design: 'STATELESS - pass walletId on every request',
  flow: [
    '1. POST /wallet/create → get walletId',
    '2. Agent stores walletId in its context',
    '3. All subsequent calls pass walletId',
  ],
  endpoints: [
    'GET  /health                         → status + monitoring info + storage type',
    'GET  /fees',
    'GET  /fees/calculate?amount=1000',
    'GET  /pools/scan?tokenA=SOL&tokenB=USDC',
    'POST /encrypt',
    'GET  /encrypt/info',
    'POST /wallet/create                  → returns walletId',
    'GET  /wallet/:walletId               → wallet info',
    'GET  /wallet/:walletId/balance       → balance',
    'POST /lp/open    { walletId, ... }   → open position',
    'POST /lp/close   { walletId, ... }   → close position',
    'POST /lp/execute { walletId, ... }   → full pipeline',
    'POST /lp/withdraw  { walletAddress, poolAddress, positionAddress } → withdraw with PnL',
    'POST /lp/withdraw/atomic { ..., convertToSol } → atomic withdrawal via Jito (optional: convert all to SOL)',
    'POST /fees/claim { walletAddress, poolAddress, positionAddress } → claim fees only',
    'POST /fees/compound { ... } → claim + instructions to re-add',
    'POST /lp/rebalance { walletId, poolAddress, positionAddress, ... } → prepare rebalance',
    'POST /lp/rebalance/execute { ... }   → execute atomic rebalance',
    'GET  /positions/:walletId            → list positions (with token names & prices)',
    'GET  /positions?address=...          → list positions by address',
    'POST /chat       { message, walletId? }',
    '--- Monitoring ---',
    'POST /monitor/add                    → add position to monitor',
    'DELETE /monitor/remove/:address      → stop tracking position',
    'GET  /monitor/positions              → list all monitored positions',
    'GET  /monitor/status/:address        → get current status of position',
    'POST /monitor/webhook                → configure webhook for alerts',
    'GET  /monitor/webhook                → get webhook config',
    'POST /monitor/webhook/test           → send test alert to webhook',
    'DELETE /monitor/webhook              → remove webhook',
    'POST /monitor/check                  → manually trigger check',
  ],
}));

app.get('/health', (c) => {
  const positions = monitor.getPositions();
  const webhookConfigured = getWebhookConfig() !== null;
  const storageInfo = getStorageInfo();

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    monitoring: {
      enabled: monitoringState.enabled,
      positionsTracked: positions.length,
      webhookConfigured,
      lastCheck: monitoringState.lastCheck,
      intervalMs: parseInt(process.env.MONITOR_INTERVAL_MS || '300000'),
    },
    storage: {
      type: storageInfo.type,
      redisAvailable: storageInfo.available,
    },
  });
});

// Usage stats endpoint
app.get('/stats', (c) => {
  const uptime = Date.now() - new Date(stats.startedAt).getTime();
  const hours = Math.floor(uptime / 3600000);
  const minutes = Math.floor((uptime % 3600000) / 60000);

  return c.json({
    status: 'operational',
    uptime: `${hours}h ${minutes}m`,
    startedAt: stats.startedAt,
    requests: {
      total: stats.requests.total,
      byEndpoint: stats.requests.byEndpoint,
      last24hByHour: Object.fromEntries(
        Object.entries(stats.requests.byHour)
          .filter(([hour]) => new Date(hour + ':00:00Z').getTime() > Date.now() - 86400000)
          .sort((a, b) => a[0].localeCompare(b[0]))
      ),
    },
    actions: stats.actions,
    errors: stats.errors,
    lastRequest: stats.lastRequest,
  });
});

// Debug endpoint to check config (no secrets exposed)
app.get('/debug/config', (c) => c.json({
  privy: {
    appIdSet: !!config.privy.appId,
    appIdLength: config.privy.appId?.length || 0,
    appIdPreview: config.privy.appId ? config.privy.appId.substring(0, 8) + '...' : 'NOT SET',
    secretSet: !!config.privy.appSecret,
    secretLength: config.privy.appSecret?.length || 0,
    authKeySet: !!config.privy.authorizationPrivateKey,
    authKeyLength: config.privy.authorizationPrivateKey?.length || 0,
    authKeyPreview: config.privy.authorizationPrivateKey ? config.privy.authorizationPrivateKey.substring(0, 20) + '...' : 'NOT SET',
    enabled: config.privy.enabled,
  },
  solana: {
    rpcSet: !!config.solana.rpc,
  },
  env: {
    PRIVY_APP_ID: process.env.PRIVY_APP_ID ? process.env.PRIVY_APP_ID.substring(0, 8) + '...' : 'NOT SET',
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET ? 'SET (' + process.env.PRIVY_APP_SECRET.length + ' chars)' : 'NOT SET',
    PRIVY_AUTHORIZATION_PRIVATE_KEY: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY ? 'SET (' + process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY.length + ' chars)' : 'NOT SET',
  }
}));

// ============ Position Monitoring API ============

/**
 * POST /monitor/add
 * Add a position to monitoring
 */
app.post('/monitor/add', async (c) => {
  try {
    const body = await c.req.json();
    const { positionAddress, poolAddress, walletAddress, binRange, webhookUrl, alerts } = body;

    if (!positionAddress || !poolAddress) {
      return c.json({
        error: 'Missing positionAddress or poolAddress',
        example: {
          positionAddress: 'your-position-address',
          poolAddress: 'pool-address',
          walletAddress: 'wallet-address (optional, for auto-discovering binRange)',
          binRange: { min: 100, max: 120 },
          alerts: { outOfRange: true, valueChangePercent: 10 },
        },
      }, 400);
    }

    // Auto-discover bin range if not provided
    let actualBinRange = binRange;
    let poolInfo = null;

    if (!binRange || (binRange.min === 0 && binRange.max === 0)) {
      if (walletAddress) {
        console.log(`[Monitor] Auto-discovering bin range for position ${positionAddress}...`);
        const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
        const discoveredRange = await getPositionBinRange(conn, poolAddress, positionAddress, walletAddress);

        if (discoveredRange) {
          actualBinRange = discoveredRange;
          console.log(`[Monitor] Discovered bin range: ${discoveredRange.min} to ${discoveredRange.max}`);
        } else {
          console.warn(`[Monitor] Could not auto-discover bin range, using defaults`);
          actualBinRange = { min: 0, max: 0 };
        }

        // Also get pool info for better context
        poolInfo = await getPoolInfo(conn, poolAddress);
      } else {
        console.warn(`[Monitor] No walletAddress provided, cannot auto-discover bin range`);
        actualBinRange = { min: 0, max: 0 };
      }
    }

    const position: MonitoredPosition = {
      positionAddress,
      poolAddress,
      binRange: actualBinRange,
      alertsEnabled: {
        outOfRange: alerts?.outOfRange ?? true,
        valueChange: alerts?.valueChangePercent ?? 0,
      },
      createdAt: new Date().toISOString(),
    };

    // Add to monitor
    monitor.addPosition(position);

    // Persist
    persistAddPosition(position);

    // If per-position webhook provided, set it (overrides global)
    if (webhookUrl) {
      const webhookConfig: WebhookConfig = {
        url: webhookUrl,
        events: ['all'],
        createdAt: new Date().toISOString(),
        deliveryStats: { successful: 0, failed: 0 },
      };
      setWebhookConfig(webhookConfig);
      persistSetWebhook(webhookConfig);
    }

    return c.json({
      success: true,
      message: `Position ${positionAddress} added to monitoring`,
      position,
      poolInfo,
      binRangeSource: binRange ? 'provided' : 'auto-discovered',
      totalMonitored: monitor.getPositions().length,
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Failed to add position', details: error.message }, 500);
  }
});

/**
 * DELETE /monitor/remove/:positionAddress
 * Stop tracking a position
 */
app.delete('/monitor/remove/:positionAddress', (c) => {
  try {
    const positionAddress = c.req.param('positionAddress');

    monitor.removePosition(positionAddress);
    persistRemovePosition(positionAddress);

    return c.json({
      success: true,
      message: `Position ${positionAddress} removed from monitoring`,
      totalMonitored: monitor.getPositions().length,
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Failed to remove position', details: error.message }, 500);
  }
});

/**
 * GET /monitor/positions
 * List all monitored positions with current status
 */
app.get('/monitor/positions', (c) => {
  const positions = monitor.getPositions();

  return c.json({
    success: true,
    count: positions.length,
    positions: positions.map(p => ({
      ...p,
      lastChecked: p.lastChecked || null,
      lastActiveBin: p.lastActiveBin || null,
    })),
  });
});

/**
 * GET /monitor/status/:positionAddress
 * Get current status of one position
 */
app.get('/monitor/status/:positionAddress', async (c) => {
  try {
    const positionAddress = c.req.param('positionAddress');

    const status = await monitor.getPositionStatus(positionAddress);
    const position = monitor.getPositions().find(p => p.positionAddress === positionAddress);

    return c.json({
      success: true,
      positionAddress,
      poolAddress: position?.poolAddress,
      ...status,
      direction: !status.inRange
        ? (status.activeBin < status.binRange.min ? 'below' : 'above')
        : null,
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Failed to get status', details: error.message }, 500);
  }
});

/**
 * POST /monitor/webhook
 * Register a global webhook for alerts
 */
app.post('/monitor/webhook', async (c) => {
  try {
    const body = await c.req.json();
    const { url, secret, events } = body;

    if (!url) {
      return c.json({
        error: 'Missing url',
        example: {
          url: 'https://your-server.com/webhook',
          secret: 'optional-hmac-secret',
          events: ['out_of_range', 'value_change', 'all'],
        },
      }, 400);
    }

    const webhookConfig: WebhookConfig = {
      url,
      secret: secret || undefined,
      events: events || ['all'],
      createdAt: new Date().toISOString(),
      deliveryStats: { successful: 0, failed: 0 },
    };

    setWebhookConfig(webhookConfig);
    persistSetWebhook(webhookConfig);

    // Test the webhook
    const testResult = await testWebhook();

    return c.json({
      success: true,
      message: 'Webhook configured',
      webhook: {
        url: webhookConfig.url,
        hasSecret: !!webhookConfig.secret,
        events: webhookConfig.events,
      },
      testDelivery: testResult,
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Failed to configure webhook', details: error.message }, 500);
  }
});

/**
 * DELETE /monitor/webhook
 * Remove webhook
 */
app.delete('/monitor/webhook', (c) => {
  setWebhookConfig(null);
  persistSetWebhook(null);

  return c.json({
    success: true,
    message: 'Webhook removed',
  });
});

/**
 * POST /monitor/check
 * Manually trigger a check of all positions
 */
app.post('/monitor/check', async (c) => {
  try {
    const alerts = await runMonitoringCheck();

    return c.json({
      success: true,
      message: `Checked ${monitor.getPositions().length} positions`,
      alertsFound: alerts.length,
      alerts,
      webhookConfigured: getWebhookConfig() !== null,
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Check failed', details: error.message }, 500);
  }
});

/**
 * GET /monitor/webhook
 * Get current webhook configuration
 */
app.get('/monitor/webhook', (c) => {
  const config = getWebhookConfig();

  if (!config) {
    return c.json({
      success: true,
      configured: false,
      webhook: null,
    });
  }

  return c.json({
    success: true,
    configured: true,
    webhook: {
      url: config.url,
      hasSecret: !!config.secret,
      events: config.events,
      lastDelivery: config.lastDelivery || null,
      stats: config.deliveryStats,
    },
  });
});

/**
 * POST /monitor/webhook/test
 * Send a test alert to the configured webhook
 */
app.post('/monitor/webhook/test', async (c) => {
  try {
    const webhookConfig = getWebhookConfig();
    
    if (!webhookConfig) {
      return c.json({
        success: false,
        error: 'No webhook configured',
        hint: 'First configure a webhook with POST /monitor/webhook',
      }, 400);
    }
    
    const result = await testWebhook();
    
    return c.json({
      success: result.success,
      message: result.success 
        ? '✅ Test alert delivered successfully!' 
        : '❌ Test alert delivery failed',
      webhook: {
        url: webhookConfig.url,
        hasSecret: !!webhookConfig.secret,
      },
      delivery: {
        success: result.success,
        statusCode: result.statusCode,
        error: result.error,
        attempts: result.attempts,
        durationMs: result.duration,
      },
      payload: {
        event: 'out_of_range',
        position: 'test-position-address',
        message: '🧪 This is a test alert from LP Toolkit',
        data: { test: true },
      },
      verification: webhookConfig.secret ? {
        header: 'X-Signature',
        format: 'sha256=<hmac-hex>',
        example: 'Verify with: crypto.createHmac("sha256", secret).update(body).digest("hex")',
      } : null,
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Webhook test failed', details: error.message }, 500);
  }
});

// ============ Fees ============

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

// ============ Pools ============

app.get('/pools/scan', (c) => {
  const tokenA = c.req.query('tokenA') || 'SOL';
  const tokenB = c.req.query('tokenB') || 'USDC';
  const pools = SAMPLE_POOLS.filter(p =>
    p.tokens.includes(tokenA.toUpperCase()) &&
    p.tokens.includes(tokenB.toUpperCase())
  );
  return c.json({
    success: true,
    pair: `${tokenA}-${tokenB}`,
    count: pools.length,
    pools,
  });
});

// ============ Arcium Encryption ============

app.get('/encrypt/info', async (c) => {
  await arciumPrivacy.initialize();
  const info = arciumPrivacy.getMxeInfo();
  return c.json({
    status: 'ready',
    algorithm: 'x25519-aes256gcm',
    mxe: { cluster: info.cluster, network: 'devnet' },
  });
});

app.post('/encrypt', async (c) => {
  try {
    const body = await c.req.json();
    const { strategy } = body;
    if (!strategy) {
      return c.json({ error: 'Missing strategy object' }, 400);
    }
    await arciumPrivacy.initialize();
    const encrypted = await arciumPrivacy.encryptStrategy(strategy);
    stats.actions.encryptions++;
    return c.json({
      success: true,
      encrypted: {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        ephemeralPublicKey: encrypted.publicKey,
        algorithm: encrypted.algorithm,
        mxeCluster: encrypted.mxeCluster,
      },
    });
  } catch (error) {
    stats.errors++;
    return c.json({ error: 'Encryption failed' }, 500);
  }
});

app.get('/encrypt/test', async (c) => {
  await arciumPrivacy.initialize();
  const passed = await arciumPrivacy.selfTest();
  return c.json({ success: passed, algorithm: 'x25519-aes256gcm' });
});

// ============ Wallet ============

// Create new wallet - returns walletId for agent to store
app.post('/wallet/create', async (c) => {
  const client = await createPrivyClient();
  if (!client) {
    stats.errors++;
    return c.json({ error: 'Privy not available', hint: 'Check PRIVY_APP_ID and PRIVY_APP_SECRET env vars' }, 503);
  }
  try {
    const wallet = await client.generateWallet();
    stats.actions.walletsCreated++;
    return c.json({
      success: true,
      wallet: {
        id: wallet.id,              // Agent MUST store this
        address: wallet.addresses.solana,
        provider: 'privy',
      },
      hint: 'Store walletId - pass it in all future requests',
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Wallet creation failed', details: error.message }, 500);
  }
});

// Get wallet info by ID (stateless lookup)
app.get('/wallet/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    return c.json({
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        provider: 'privy',
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Wallet not found', details: error.message }, 404);
  }
});

// Get balance by walletId (stateless)
app.get('/wallet/:walletId/balance', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    const balance = await connection.getBalance(new PublicKey(wallet.address));
    return c.json({
      success: true,
      walletId,
      address: wallet.address,
      balance: {
        lamports: balance,
        sol: balance / LAMPORTS_PER_SOL,
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Balance check failed', details: error.message }, 500);
  }
});

// ============ LP Positions ============

// Open LP position - requires walletId (stateless)
app.post('/lp/open', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, poolAddress, amountA, amountB, binRange, encrypt = true } = body;

    if (!walletId) {
      return c.json({
        error: 'Missing walletId',
        hint: 'First call POST /wallet/create, then pass the returned walletId here'
      }, 400);
    }

    if (!poolAddress || !amountA) {
      return c.json({ error: 'Missing poolAddress or amountA' }, 400);
    }

    // Load wallet fresh for this request (stateless)
    const { client, wallet } = await loadWalletById(walletId);

    // Build LP strategy
    const strategy = {
      action: 'ADD_LIQUIDITY',
      pool: poolAddress,
      amountA,
      amountB: amountB || 0,
      binRange: binRange || [127, 133],
      timestamp: Date.now(),
    };

    // Encrypt strategy if requested
    let encryptedStrategy = null;
    if (encrypt) {
      await arciumPrivacy.initialize();
      encryptedStrategy = await arciumPrivacy.encryptStrategy(strategy);
    }

    // Build transaction
    const walletPubkey = new PublicKey(wallet.address);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: walletPubkey,
        toPubkey: walletPubkey,
        lamports: 0,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = walletPubkey;

    // Sign with Privy (stateless - wallet loaded fresh)
    const txBase64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');
    const signedTxBase64 = await client.signTransaction(txBase64);

    const fee = (amountA * FEE_CONFIG.FEE_BPS) / 10000;

    return c.json({
      success: true,
      walletId,
      position: {
        pool: poolAddress,
        amountA,
        amountB: amountB || 0,
        binRange: binRange || [127, 133],
        estimatedFee: fee,
        treasury: FEE_CONFIG.TREASURY,
      },
      encrypted: encryptedStrategy ? {
        ciphertext: encryptedStrategy.ciphertext,
        algorithm: encryptedStrategy.algorithm,
        mxeCluster: encryptedStrategy.mxeCluster,
      } : null,
      transaction: {
        serialized: signedTxBase64,
        status: 'ready_to_broadcast',
        note: 'Demo transaction - production would use Meteora DLMM SDK',
      },
    });
  } catch (error: any) {
    console.error('LP open error:', error);
    return c.json({ error: 'LP position failed', details: error.message }, 500);
  }
});

// Close LP position - requires walletId (stateless)
app.post('/lp/close', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, positionAddress } = body;

    if (!walletId) {
      return c.json({ error: 'Missing walletId' }, 400);
    }

    if (!positionAddress) {
      return c.json({ error: 'Missing positionAddress' }, 400);
    }

    // Load wallet for signing (stateless)
    const { wallet } = await loadWalletById(walletId);

    return c.json({
      success: true,
      walletId,
      walletAddress: wallet.address,
      message: 'Position close prepared',
      position: positionAddress,
      note: 'Demo - production would withdraw from Meteora DLMM',
    });
  } catch (error: any) {
    return c.json({ error: 'LP close failed', details: error.message }, 500);
  }
});

// ============ Chat Interface (Stateless NL) ============

app.post('/chat', async (c) => {
  try {
    const { message, walletId } = await c.req.json();
    if (!message) {
      return c.json({ error: 'Missing message' }, 400);
    }

    // Simple NL parsing
    const lower = message.toLowerCase();
    let response: any = {
      understood: false,
      message: 'I didn\'t understand that. Try: "LP $500 into SOL-USDC"',
      hint: 'Include walletId in request if you have one',
    };

    if (lower.includes('lp') || lower.includes('liquidity')) {
      const amountMatch = message.match(/\$?([\d,]+)/);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : null;

      if (amount) {
        const fee = (amount * FEE_CONFIG.FEE_BPS) / 10000;
        response = {
          understood: true,
          intent: 'ADD_LIQUIDITY',
          parsed: {
            amount,
            pair: lower.includes('usdc') ? 'SOL-USDC' : 'SOL-USDC',
            fee,
          },
          walletId: walletId || null,
          nextStep: walletId
            ? `Call POST /lp/open with { walletId: "${walletId}", poolAddress, amountA }`
            : 'First call POST /wallet/create to get a walletId',
          pools: SAMPLE_POOLS,
        };
      }
    } else if (lower.includes('balance') || lower.includes('wallet')) {
      response = {
        understood: true,
        intent: 'CHECK_BALANCE',
        walletId: walletId || null,
        nextStep: walletId
          ? `Call GET /wallet/${walletId}/balance`
          : 'First call POST /wallet/create to get a walletId',
      };
    } else if (lower.includes('pool') || lower.includes('yield') || lower.includes('apy')) {
      response = {
        understood: true,
        intent: 'SCAN_POOLS',
        pools: SAMPLE_POOLS,
        bestPool: SAMPLE_POOLS[0],
      };
    } else if (lower.includes('position') || lower.includes('my lp')) {
      response = {
        understood: true,
        intent: 'GET_POSITIONS',
        walletId: walletId || null,
        nextStep: walletId
          ? `Call GET /positions/${walletId}`
          : 'First call POST /wallet/create to get a walletId',
      };
    }

    return c.json(response);
  } catch (error: any) {
    return c.json({ error: 'Chat failed', details: error.message }, 500);
  }
});

// ============ Swap Endpoints ============

const TOKENS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

app.get('/swap/tokens', (c) => {
  return c.json({
    tokens: TOKENS,
    description: 'Well-known token mints. Use symbol (SOL, USDC) or full mint address.',
  });
});

app.post('/swap', async (c) => {
  try {
    const body = await c.req.json();
    const { inputToken, outputToken, amount } = body;

    if (!inputToken || !outputToken || !amount) {
      return c.json({ error: 'Missing inputToken, outputToken, or amount' }, 400);
    }

    const inputMint = TOKENS[inputToken.toUpperCase()] || inputToken;
    const outputMint = TOKENS[outputToken.toUpperCase()] || outputToken;

    // Demo response - production would use Jupiter API
    return c.json({
      success: true,
      message: `Swap prepared: ${amount} ${inputToken} -> ${outputToken}`,
      data: {
        inputMint,
        outputMint,
        amount,
        estimatedOutput: amount * 150, // Demo rate
        fee: amount * FEE_CONFIG.FEE_BPS / 10000,
        route: 'Jupiter Aggregator',
      },
      note: 'Demo mode - production executes via Jupiter',
    });
  } catch (error: any) {
    return c.json({ error: 'Swap failed', details: error.message }, 500);
  }
});

app.get('/swap/quote', async (c) => {
  const inputToken = c.req.query('inputToken') || c.req.query('inputMint');
  const outputToken = c.req.query('outputToken') || c.req.query('outputMint');
  const amount = c.req.query('amount');

  if (!inputToken || !outputToken || !amount) {
    return c.json({ error: 'Missing inputToken, outputToken, or amount' }, 400);
  }

  const inputMint = TOKENS[inputToken.toUpperCase()] || inputToken;
  const outputMint = TOKENS[outputToken.toUpperCase()] || outputToken;

  return c.json({
    success: true,
    quote: {
      inputMint,
      outputMint,
      inAmount: amount,
      outAmount: parseFloat(amount) * 150,
      priceImpact: '0.01%',
      route: 'Jupiter',
    },
  });
});

// ============ Position Endpoints (Stateless) ============

// UNIVERSAL DISCOVERY - No hardcoded pools!
// Uses Meteora SDK's getAllLbPairPositionsByUser to find ALL positions

// Get positions by walletId
app.get('/positions/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    // Universal discovery - finds ALL positions across ALL DLMM pools
    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const positions = await discoverAllPositions(conn, walletAddress);

    return c.json({
      success: true,
      message: `Found ${positions.length} positions across all DLMM pools`,
      data: {
        walletId,
        walletAddress,
        positions,
        totalPositions: positions.length,
      },
      note: 'Universal discovery - no hardcoded pool list, finds positions in ANY Meteora DLMM pool',
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
  }
});

// Query positions by wallet address (no Privy needed)
app.get('/positions', async (c) => {
  const walletAddress = c.req.query('address') || c.req.query('walletAddress');

  if (!walletAddress) {
    return c.json({
      success: false,
      error: 'Missing wallet address',
      hint: 'Use GET /positions?address=YOUR_WALLET_ADDRESS or GET /positions/:walletId',
      example: 'GET /positions?address=Ab6Cuvz9rZUSb4uVbBGR6vm12LeuVBE5dzKsnYUtAEi4',
    });
  }

  try {
    // Universal discovery - finds ALL positions across ALL DLMM pools
    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const positions = await discoverAllPositions(conn, walletAddress);

    return c.json({
      success: true,
      message: `Found ${positions.length} positions across all DLMM pools`,
      data: {
        walletAddress,
        positions,
        totalPositions: positions.length,
      },
      note: 'Universal discovery - no hardcoded pool list, finds positions in ANY Meteora DLMM pool',
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
  }
});

// ============ LP Pipeline Endpoints ============

app.get('/lp/pools', (c) => {
  return c.json({
    pools: SAMPLE_POOLS,
    description: 'Supported Meteora DLMM pools for LP pipeline',
  });
});

// Execute LP pipeline - requires walletId (stateless)
app.post('/lp/execute', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      amountSol = 0.1,
      minBinId = -10,
      maxBinId = 10,
      strategy = 'concentrated',
      shape = 'spot',
      tipSpeed = 'fast',
      slippageBps = 300,
    } = body;

    if (!walletId) {
      return c.json({
        error: 'Missing walletId',
        hint: 'First call POST /wallet/create, store the walletId, then pass it here',
        example: {
          walletId: 'abc123',
          poolAddress: '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7',
          amountSol: 0.1,
          minBinId: -10,
          maxBinId: 10,
        }
      }, 400);
    }

    if (!poolAddress) {
      return c.json({
        error: 'Missing poolAddress',
        hint: 'Use /pools/scan to find available pools',
        example: {
          walletId: 'abc123',
          poolAddress: '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7',
          amountSol: 0.1,
        }
      }, 400);
    }

    // Load wallet (stateless)
    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    console.log(`[LP Execute] Opening position: ${amountSol} SOL in pool ${poolAddress}`);

    // Convert SOL to lamports
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    const solMint = 'So11111111111111111111111111111111111111112';

    // Build atomic LP transactions
    const lpResult = await buildAtomicLP({
      walletAddress,
      poolAddress,
      collateralMint: solMint,
      collateralAmount: lamports,
      strategy: strategy as 'concentrated' | 'wide' | 'custom',
      shape: shape as 'spot' | 'curve' | 'bidask',
      minBinId,
      maxBinId,
      tipSpeed: tipSpeed as TipSpeed,
      slippageBps,
    });

    console.log(`[LP Execute] Built ${lpResult.unsignedTransactions.length} transactions, signing...`);

    // Sign all transactions with Privy
    const signedTxs: string[] = [];
    for (const unsignedTx of lpResult.unsignedTransactions) {
      try {
        const signedTx = await client.signTransaction(unsignedTx);
        signedTxs.push(signedTx);
      } catch (signErr: any) {
        // Already partially signed with position keypair
        signedTxs.push(unsignedTx);
      }
    }

    // Submit to Jito
    console.log(`[LP Execute] Submitting ${signedTxs.length} txs to Jito...`);
    const { bundleId } = await sendBundle(signedTxs);
    console.log(`[LP Execute] Bundle submitted: ${bundleId}`);

    // Wait for confirmation
    const status = await waitForBundle(bundleId, { timeoutMs: 60000 });

    if (!status.landed) {
      return c.json({
        success: false,
        error: 'Bundle failed to land',
        bundleId,
        details: status.error,
      }, 500);
    }

    console.log(`[LP Execute] ✅ Position opened at slot ${status.slot}!`);

    stats.actions.lpExecuted++;
    return c.json({
      success: true,
      message: `LP position opened with ${amountSol} SOL`,
      walletId,
      walletAddress,
      poolAddress,
      binRange: lpResult.binRange,
      bundle: {
        bundleId,
        landed: status.landed,
        slot: status.slot,
      },
      encryptedStrategy: lpResult.encryptedStrategy,
    });
  } catch (error: any) {
    console.error('[LP Execute] Error:', error);
    stats.errors++;
    return c.json({ error: 'LP execute failed', details: error.message }, 500);
  }
});

app.post('/lp/prepare', async (c) => {
  try {
    const body = await c.req.json();
    const { tokenA, tokenB, amount } = body;

    if (!tokenA || !tokenB || !amount) {
      return c.json({ error: 'Missing tokenA, tokenB, or amount' }, 400);
    }

    return c.json({
      success: true,
      ready: true,
      message: `Ready to LP $${amount} into ${tokenA}-${tokenB}`,
      pool: SAMPLE_POOLS[0],
      fee: amount * FEE_CONFIG.FEE_BPS / 10000,
    });
  } catch (error: any) {
    return c.json({ error: 'LP prepare failed', details: error.message }, 500);
  }
});

// ============ Rebalance Endpoint ============

/**
 * POST /lp/rebalance
 *
 * Rebalance an existing LP position by:
 * 1. Withdrawing from current position (atomic via Jito)
 * 2. Re-entering with new bin range
 *
 * All done in atomic bundles for MEV protection.
 */
app.post('/lp/rebalance', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      positionAddress,
      newLowerBin,
      newUpperBin,
      strategy = 'concentrated',
      shape = 'spot',
      tipSpeed = 'fast',
      slippageBps = 300,
    } = body;

    // Validate required params
    if (!walletId) {
      return c.json({
        error: 'Missing walletId',
        hint: 'First call POST /wallet/create, store the walletId, then pass it here',
      }, 400);
    }

    if (!poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing poolAddress or positionAddress',
        hint: 'Get these from GET /positions/:walletId',
        example: {
          walletId: 'your-wallet-id',
          poolAddress: 'pool-address-from-position',
          positionAddress: 'position-address-to-rebalance',
          newLowerBin: -10,
          newUpperBin: 10,
          strategy: 'concentrated',
        },
      }, 400);
    }

    // Load wallet
    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    console.log(`[Rebalance] Starting for position ${positionAddress} in pool ${poolAddress}`);

    // Step 1: Get current position info
    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pool = await DLMM.create(conn, new PublicKey(poolAddress));
    const userPubkey = new PublicKey(walletAddress);
    const positions = await pool.getPositionsByUserAndLbPair(userPubkey);

    const position = positions.userPositions.find(
      (p: any) => p.publicKey.toBase58() === positionAddress
    );

    if (!position) {
      return c.json({
        error: 'Position not found',
        hint: 'Check that positionAddress is correct and belongs to this wallet',
      }, 404);
    }

    // Get pool info for response
    const binStep = Number(pool.lbPair.binStep);
    const activeBin = await pool.getActiveBin();
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const tokenYMint = pool.tokenY.publicKey.toBase58();

    // Resolve token metadata
    const tokenMetadata = await resolveTokens([tokenXMint, tokenYMint]);
    const tokenX = tokenMetadata.get(tokenXMint);
    const tokenY = tokenMetadata.get(tokenYMint);

    // Current position info
    const currentLower = position.positionData.lowerBinId;
    const currentUpper = position.positionData.upperBinId;
    // Use pricePerToken for human-readable price (accounts for token decimals)
    const currentPrice = Number(activeBin.pricePerToken);

    // Calculate human-readable price ranges
    const currentPriceRange = calculateHumanPriceRange(
      currentLower, currentUpper, activeBin.binId, currentPrice, binStep
    );

    // New position info (relative to active bin if not absolute)
    let targetLower = newLowerBin !== undefined ? activeBin.binId + newLowerBin : currentLower;
    let targetUpper = newUpperBin !== undefined ? activeBin.binId + newUpperBin : currentUpper;

    // Use strategy defaults if no custom bins provided
    if (newLowerBin === undefined && newUpperBin === undefined) {
      if (strategy === 'wide') {
        targetLower = activeBin.binId - 20;
        targetUpper = activeBin.binId + 20;
      } else {
        // concentrated
        targetLower = activeBin.binId - 5;
        targetUpper = activeBin.binId + 5;
      }
    }

    const newPriceRange = calculateHumanPriceRange(
      targetLower, targetUpper, activeBin.binId, currentPrice, binStep
    );

    // Step 2: Build withdrawal transactions
    console.log(`[Rebalance] Building withdrawal for position ${positionAddress}...`);
    const withdrawResult = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed: tipSpeed as TipSpeed,
    });

    // Estimate collateral from position
    const totalXAmount = position.positionData.totalXAmount?.toString() || '0';
    const totalYAmount = position.positionData.totalYAmount?.toString() || '0';

    // Step 3: Build re-entry transactions
    // For now, we'll use the estimated withdrawn amounts as collateral for new position
    // In production, you'd want to wait for withdraw to confirm first
    console.log(`[Rebalance] Building new LP position with bins ${targetLower} to ${targetUpper}...`);

    // Determine collateral mint (use SOL by default for simplicity)
    const solMint = 'So11111111111111111111111111111111111111112';
    const collateralMint = tokenXMint === solMint ? tokenXMint : tokenYMint;
    const estimatedCollateral = tokenXMint === solMint
      ? parseInt(totalXAmount) + parseInt(totalYAmount)
      : parseInt(totalYAmount) + parseInt(totalXAmount);

    // Note: In a full implementation, we'd wait for withdraw to land,
    // then build the new LP tx. For atomic rebalance in same bundle,
    // we need both txs pre-built.

    // For now, return the withdraw bundle and instructions for re-entry
    stats.actions.lpWithdrawn++;

    return c.json({
      success: true,
      message: 'Rebalance prepared',
      walletId,
      walletAddress,
      currentPosition: {
        address: positionAddress,
        binRange: { lower: currentLower, upper: currentUpper },
        priceRange: {
          priceLower: currentPriceRange.priceLower,
          priceUpper: currentPriceRange.priceUpper,
          display: formatPriceRange(currentPriceRange.priceLower, currentPriceRange.priceUpper, tokenY?.symbol || 'Y', tokenX?.symbol || 'X'),
        },
        inRange: currentPriceRange.inRange,
      },
      newPosition: {
        binRange: { lower: targetLower, upper: targetUpper },
        priceRange: {
          priceLower: newPriceRange.priceLower,
          priceUpper: newPriceRange.priceUpper,
          display: formatPriceRange(newPriceRange.priceLower, newPriceRange.priceUpper, tokenY?.symbol || 'Y', tokenX?.symbol || 'X'),
        },
        strategy,
        shape,
      },
      pool: {
        address: poolAddress,
        binStep,
        tokenX: { mint: tokenXMint, symbol: tokenX?.symbol || 'Unknown' },
        tokenY: { mint: tokenYMint, symbol: tokenY?.symbol || 'Unknown' },
        activeBinId: activeBin.binId,
        currentPrice,
        displayPrice: `${formatPrice(currentPrice)} ${tokenY?.symbol || 'Unknown'} per ${tokenX?.symbol || 'Unknown'}`,
      },
      withdraw: {
        transactions: withdrawResult.unsignedTransactions,
        estimatedWithdraw: withdrawResult.estimatedWithdraw,
        fee: withdrawResult.fee,
      },
      reentry: {
        hint: 'After withdraw lands, call POST /lp/execute with the withdrawn funds',
        params: {
          walletId,
          poolAddress,
          strategy,
          shape,
          minBinId: targetLower - activeBin.binId,
          maxBinId: targetUpper - activeBin.binId,
          tipSpeed,
          slippageBps,
        },
      },
      note: 'Sign withdraw transactions with Privy, submit via Jito, then execute re-entry',
    });
  } catch (error: any) {
    console.error('[Rebalance] Error:', error);
    stats.errors++;
    return c.json({ error: 'Rebalance failed', details: error.message }, 500);
  }
});

/**
 * POST /lp/rebalance/execute
 *
 * Execute resilient rebalance (two-phase with recovery)
 * Phase 1: Withdraw position
 * Phase 2: Re-enter with new range
 * 
 * If Phase 1 succeeds but Phase 2 fails, tokens are safe in wallet
 * and can be manually re-entered via POST /lp/execute
 */
app.post('/lp/rebalance/execute', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      positionAddress,
      newMinBinOffset = -5,
      newMaxBinOffset = 5,
      strategy = 'concentrated',
      shape = 'spot',
      tipSpeed = 'fast',
      slippageBps = 300,
    } = body;

    if (!walletId || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing walletId, poolAddress, or positionAddress',
      }, 400);
    }

    // Load wallet
    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    console.log(`[Rebalance Execute] Starting resilient two-phase rebalance...`);

    // Execute the resilient rebalance with Privy signing
    const result = await executeRebalance({
      walletAddress,
      walletId,
      poolAddress,
      positionAddress,
      newMinBinOffset,
      newMaxBinOffset,
      strategy: strategy as 'concentrated' | 'wide',
      shape: shape as 'spot' | 'curve' | 'bidask',
      tipSpeed: tipSpeed as TipSpeed,
      slippageBps,
      signTransaction: async (tx: string) => {
        try {
          return await client.signTransaction(tx);
        } catch (e) {
          // May already be signed with position keypair
          return tx;
        }
      },
    });

    stats.actions.lpExecuted++;

    if (result.success) {
      console.log(`[Rebalance Execute] ✅ Rebalance complete!`);
    } else {
      console.log(`[Rebalance Execute] ⚠️ Partial: Phase1=${result.phase1.status}, Phase2=${result.phase2.status}`);
    }

    return c.json({
      success: result.success,
      message: result.success 
        ? 'Rebalance completed successfully!' 
        : `Rebalance ${result.phase1.status === 'success' ? 'partial' : 'failed'}: ${result.recoveryHint}`,
      walletId,
      walletAddress,
      phase1: result.phase1,
      phase2: result.phase2,
      oldPosition: result.oldPosition,
      newPosition: result.newPosition,
      tokensInWallet: result.tokensInWallet,
      recoveryHint: result.recoveryHint,
    });
  } catch (error: any) {
    console.error('[Rebalance Execute] Error:', error);
    stats.errors++;
    return c.json({ 
      error: 'Rebalance execution failed', 
      details: error.message,
    }, 500);
  }
});

// ============ Withdraw Endpoints ============

/**
 * POST /lp/withdraw
 *
 * Build withdrawal transactions for an LP position.
 * Returns unsigned transactions and PnL summary.
 */
app.post('/lp/withdraw', async (c) => {
  try {
    const body = await c.req.json();
    const { walletAddress, poolAddress, positionAddress, tipSpeed = 'fast' } = body;

    if (!walletAddress || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing walletAddress, poolAddress, or positionAddress',
        example: {
          walletAddress: 'your-wallet-address',
          poolAddress: 'pool-address',
          positionAddress: 'position-address-to-withdraw',
          tipSpeed: 'fast',
        },
      }, 400);
    }

    console.log(`[Withdraw] Building withdrawal for position ${positionAddress}...`);

    const result = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed: tipSpeed as TipSpeed,
    });

    stats.actions.lpWithdrawn++;

    return c.json({
      success: true,
      message: 'Withdrawal transactions prepared',
      walletAddress,
      poolAddress,
      positionAddress,
      transactions: result.unsignedTransactions,
      estimatedWithdraw: result.estimatedWithdraw,
      fee: result.fee,
      pnl: result.pnl,
      encryptedStrategy: result.encryptedStrategy,
      hint: 'Sign transactions with your wallet and submit via Jito bundle',
    });
  } catch (error: any) {
    console.error('[Withdraw] Error:', error);
    stats.errors++;
    return c.json({ error: 'Withdrawal failed', details: error.message }, 500);
  }
});

/**
 * POST /lp/withdraw/atomic
 *
 * Build and return atomic withdrawal via Jito bundle.
 * Same as /lp/withdraw but explicitly for Jito atomic execution.
 */
app.post('/lp/withdraw/atomic', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed = 'fast',
      convertToSol = false, // NEW: Convert all tokens to SOL
    } = body;

    if (!walletAddress || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing walletAddress, poolAddress, or positionAddress',
        example: {
          walletAddress: 'your-wallet-address',
          poolAddress: 'pool-address',
          positionAddress: 'position-address-to-withdraw',
          tipSpeed: 'fast',
          convertToSol: true, // Optional: convert all to SOL
        },
      }, 400);
    }

    console.log(`[AtomicWithdraw] Building withdrawal for position ${positionAddress}${convertToSol ? ' (convert to SOL)' : ''}...`);

    const result = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      convertToSol,
      tipSpeed: tipSpeed as TipSpeed,
    });

    stats.actions.lpWithdrawn++;

    return c.json({
      success: true,
      message: convertToSol
        ? 'Atomic withdrawal + swap to SOL prepared via Jito'
        : 'Atomic withdrawal prepared via Jito',
      walletAddress,
      poolAddress,
      positionAddress,
      bundle: {
        transactions: result.unsignedTransactions,
        count: result.unsignedTransactions.length,
        tipSpeed,
      },
      estimatedWithdraw: result.estimatedWithdraw,
      swap: result.swap,
      fee: result.fee,
      pnl: result.pnl,
      encryptedStrategy: result.encryptedStrategy,
      hint: 'Sign all transactions and submit as Jito bundle for atomic execution',
    });
  } catch (error: any) {
    console.error('[AtomicWithdraw] Error:', error);
    stats.errors++;
    return c.json({ error: 'Atomic withdrawal failed', details: error.message }, 500);
  }
});

// ============ Fee Claim & Compound ============

// Claim fees only (don't withdraw liquidity)
app.post('/fees/claim', async (c) => {
  try {
    const body = await c.req.json();
    const { walletAddress, poolAddress, positionAddress } = body;

    if (!walletAddress || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing required parameters',
        example: {
          walletAddress: 'your-wallet-address',
          poolAddress: 'pool-address',
          positionAddress: 'position-address',
        },
      }, 400);
    }

    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pool = await DLMM.create(connection, new PublicKey(poolAddress));

    // Get position to find earned fees
    const userPositions = await pool.getPositionsByUserAndLbPair(new PublicKey(walletAddress));
    const position = userPositions.userPositions.find(
      (p: any) => p.publicKey.toBase58() === positionAddress
    );

    if (!position) {
      return c.json({ error: 'Position not found' }, 404);
    }

    const posData = position.positionData;
    const feeX = posData.feeX?.toString() || '0';
    const feeY = posData.feeY?.toString() || '0';

    if (feeX === '0' && feeY === '0') {
      return c.json({
        success: false,
        message: 'No fees to claim',
        fees: { tokenX: '0', tokenY: '0' },
      });
    }

    // Build claim fee transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const claimTx = await pool.claimSwapFee({
      owner: new PublicKey(walletAddress),
      position: position, // Pass full LbPosition object
    });

    // Serialize transaction
    const txArray = Array.isArray(claimTx) ? claimTx : [claimTx];
    const unsignedTransactions: string[] = [];

    for (const tx of txArray) {
      if ('recentBlockhash' in tx) {
        tx.recentBlockhash = blockhash;
        tx.feePayer = new PublicKey(walletAddress);
        unsignedTransactions.push(tx.serialize({ requireAllSignatures: false }).toString('base64'));
      }
    }

    return c.json({
      success: true,
      message: 'Fee claim transaction prepared',
      fees: {
        tokenX: feeX,
        tokenY: feeY,
      },
      transactions: unsignedTransactions,
      hint: 'Sign and submit to claim fees without withdrawing liquidity',
    });
  } catch (error: any) {
    console.error('[FeeClaim] Error:', error);
    return c.json({ error: 'Fee claim failed', details: error.message }, 500);
  }
});

// Compound fees back into position
app.post('/fees/compound', async (c) => {
  try {
    const body = await c.req.json();
    const { walletAddress, poolAddress, positionAddress } = body;

    if (!walletAddress || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing required parameters',
        example: {
          walletAddress: 'your-wallet-address',
          poolAddress: 'pool-address',
          positionAddress: 'position-address',
        },
      }, 400);
    }

    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pool = await DLMM.create(connection, new PublicKey(poolAddress));

    // Get position
    const userPositions = await pool.getPositionsByUserAndLbPair(new PublicKey(walletAddress));
    const position = userPositions.userPositions.find(
      (p: any) => p.publicKey.toBase58() === positionAddress
    );

    if (!position) {
      return c.json({ error: 'Position not found' }, 404);
    }

    const posData = position.positionData;
    const feeX = posData.feeX?.toString() || '0';
    const feeY = posData.feeY?.toString() || '0';

    if (feeX === '0' && feeY === '0') {
      return c.json({
        success: false,
        message: 'No fees to compound',
        fees: { tokenX: '0', tokenY: '0' },
      });
    }

    // Meteora DLMM doesn't have a native compound - you'd need to:
    // 1. Claim fees
    // 2. Add liquidity with those fees
    // For now, return the claim tx and instructions for adding liquidity

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const claimTx = await pool.claimSwapFee({
      owner: new PublicKey(walletAddress),
      position: position, // Pass full LbPosition object
    });
    
    const txArray = Array.isArray(claimTx) ? claimTx : [claimTx];
    const unsignedTransactions: string[] = [];
    
    for (const tx of txArray) {
      if ('recentBlockhash' in tx) {
        tx.recentBlockhash = blockhash;
        tx.feePayer = new PublicKey(walletAddress);
        unsignedTransactions.push(tx.serialize({ requireAllSignatures: false }).toString('base64'));
      }
    }

    return c.json({
      success: true,
      message: 'Compound: First claim fees, then call /lp/open to re-add',
      fees: {
        tokenX: feeX,
        tokenY: feeY,
      },
      step1: {
        action: 'Claim fees',
        transactions: unsignedTransactions,
      },
      step2: {
        action: 'Add liquidity with claimed fees',
        endpoint: 'POST /lp/open',
        hint: 'After fees land in wallet, call /lp/open with the fee amounts',
      },
      note: 'Meteora DLMM requires separate claim + add steps (no native compound)',
    });
  } catch (error: any) {
    console.error('[FeeCompound] Error:', error);
    return c.json({ error: 'Compound failed', details: error.message }, 500);
  }
});

// ============ Background Worker & User Management ============

import {
  startWorker,
  stopWorker,
  isWorkerRunning,
  getWorkerStatus,
  triggerPositionCheck,
  getUserSettings,
  setUserSettings,
  createDefaultSettings,
  getUserRules,
  addUserRule,
  removeUserRule,
  trackPosition,
  untrackPosition,
  getTrackedPositions,
  parseNaturalRule,
  getAlertStats,
  getFailedAlerts,
  type UserSettings,
  type TrackedPosition,
} from './monitoring/index.js';

// Worker control endpoints
app.get('/worker/status', async (c) => {
  const status = await getWorkerStatus();
  const telegramConfigured = !!process.env.TELEGRAM_BOT_TOKEN;
  
  return c.json({
    worker: status,
    telegram: {
      configured: telegramConfigured,
      token: telegramConfigured ? 'set' : 'not set',
    },
    alertStats: await getAlertStats(),
  });
});

app.post('/worker/start', async (c) => {
  if (isWorkerRunning()) {
    return c.json({ success: false, message: 'Worker already running' });
  }
  
  await startWorker();
  return c.json({ success: true, message: 'Worker started' });
});

app.post('/worker/stop', async (c) => {
  if (!isWorkerRunning()) {
    return c.json({ success: false, message: 'Worker not running' });
  }
  
  await stopWorker();
  return c.json({ success: true, message: 'Worker stopped' });
});

app.post('/worker/check', async (c) => {
  await triggerPositionCheck();
  return c.json({ success: true, message: 'Position check triggered' });
});

// User settings endpoints
app.get('/user/:userId/settings', async (c) => {
  const userId = c.req.param('userId');
  const settings = await getUserSettings(userId);
  
  if (!settings) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json(settings);
});

app.post('/user/:userId/settings', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();
  
  let settings = await getUserSettings(userId);
  
  if (!settings) {
    // Create new user
    settings = await createDefaultSettings(userId, body.telegram);
  }
  
  // Merge preferences
  if (body.preferences) {
    settings.preferences = { ...settings.preferences, ...body.preferences };
  }
  if (body.telegram) {
    settings.telegram = body.telegram;
  }
  if (body.webhook) {
    settings.webhook = body.webhook;
  }
  
  await setUserSettings(settings);
  
  return c.json({ success: true, settings });
});

// Position tracking endpoints
app.get('/user/:userId/positions', async (c) => {
  const userId = c.req.param('userId');
  const positions = await getTrackedPositions(userId);
  return c.json({ positions });
});

app.post('/user/:userId/positions/track', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();
  
  const { positionAddress, poolAddress, poolName, binRange, walletId } = body;
  
  if (!positionAddress || !poolAddress || !poolName) {
    return c.json({ error: 'Missing required fields: positionAddress, poolAddress, poolName' }, 400);
  }
  
  const position: TrackedPosition = {
    positionAddress,
    poolAddress,
    poolName,
    userId,
    walletId,
    binRange: binRange || { lower: 0, upper: 0 },
    createdAt: new Date().toISOString(),
  };
  
  await trackPosition(position);
  
  return c.json({ success: true, message: `Now tracking ${poolName}`, position });
});

app.delete('/user/:userId/positions/:positionAddress', async (c) => {
  const userId = c.req.param('userId');
  const positionAddress = c.req.param('positionAddress');
  
  await untrackPosition(userId, positionAddress);
  
  return c.json({ success: true, message: 'Position untracked' });
});

// User rules endpoints
app.get('/user/:userId/rules', async (c) => {
  const userId = c.req.param('userId');
  const rules = await getUserRules(userId);
  return c.json({ rules });
});

app.post('/user/:userId/rules', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();
  
  // Support natural language rule creation
  if (body.command) {
    const rule = parseNaturalRule(userId, body.command);
    if (rule) {
      await addUserRule(rule);
      return c.json({ success: true, message: 'Rule created from command', rule });
    } else {
      return c.json({ error: 'Could not parse command into rule', command: body.command }, 400);
    }
  }
  
  // Direct rule creation
  if (!body.type || !body.condition || !body.action) {
    return c.json({ error: 'Missing required fields: type, condition, action' }, 400);
  }
  
  const rule = {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    type: body.type,
    condition: body.condition,
    action: body.action,
    enabled: body.enabled !== false,
    triggered: false,
    createdAt: new Date().toISOString(),
    rawCommand: body.rawCommand,
  };
  
  await addUserRule(rule);
  
  return c.json({ success: true, rule });
});

app.delete('/user/:userId/rules/:ruleId', async (c) => {
  const userId = c.req.param('userId');
  const ruleId = c.req.param('ruleId');
  
  await removeUserRule(userId, ruleId);
  
  return c.json({ success: true, message: 'Rule removed' });
});

// Alert queue endpoints
app.get('/alerts/stats', async (c) => {
  const stats = await getAlertStats();
  return c.json(stats);
});

app.get('/alerts/failed', async (c) => {
  const failed = await getFailedAlerts();
  return c.json({ failed });
});

// ============ Notification System ============

import {
  getRecipient,
  upsertRecipient,
  consumeLinkCode,
  sendAlert,
  handleTelegramCallback,
  type AlertPayload,
} from './notifications/index.js';

import {
  onboardTelegram,
  onboardAgent,
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
  getUserByChat,
  linkWalletToChat,
} from './onboarding/index.js';

/**
 * One-call agent onboarding
 * Creates wallet + registers webhook in one step
 */
app.post('/onboard', async (c) => {
  try {
    const body = await c.req.json();
    const { webhookUrl, webhookSecret } = body;
    
    if (!webhookUrl) {
      return c.json({
        error: 'webhookUrl is required',
        example: {
          webhookUrl: 'https://your-agent.com/webhook',
          webhookSecret: 'optional-hmac-secret',
        },
      }, 400);
    }
    
    const result = await onboardAgent(webhookUrl, webhookSecret);
    
    return c.json({
      success: true,
      walletId: result.user.walletId,
      walletAddress: result.user.walletAddress,
      webhook: {
        url: webhookUrl,
        configured: true,
      },
      message: result.message,
      nextSteps: [
        `1. Send SOL to ${result.user.walletAddress}`,
        '2. Create LP position: POST /lp/execute { walletId, poolAddress, ... }',
        '3. Receive alerts at your webhook URL',
      ],
    });
  } catch (error: any) {
    console.error('[Onboard] Error:', error);
    return c.json({ error: 'Onboarding failed', details: error.message }, 500);
  }
});

/**
 * Register for notifications
 * Supports: Telegram (via link code) and/or Webhook URL
 */
app.post('/notify/register', async (c) => {
  const body = await c.req.json();
  const { walletId, telegramCode, webhookUrl, webhookSecret, preferences } = body;
  
  if (!walletId) {
    return c.json({ error: 'walletId is required' }, 400);
  }
  
  const updates: any = { walletId, preferences };
  
  // Link Telegram via code
  if (telegramCode) {
    const linkCode = await consumeLinkCode(telegramCode);
    if (!linkCode) {
      return c.json({ error: 'Invalid or expired link code' }, 400);
    }
    updates.telegram = {
      chatId: linkCode.chatId,
      linkedAt: new Date().toISOString(),
    };
  }
  
  // Set webhook URL
  if (webhookUrl) {
    updates.webhook = {
      url: webhookUrl,
      secret: webhookSecret,
      linkedAt: new Date().toISOString(),
    };
  }
  
  const recipient = await upsertRecipient(updates);
  
  return c.json({
    success: true,
    message: 'Notification preferences saved',
    recipient: {
      walletId: recipient.walletId,
      telegram: recipient.telegram ? { linked: true, chatId: recipient.telegram.chatId } : undefined,
      webhook: recipient.webhook ? { linked: true, url: recipient.webhook.url } : undefined,
      preferences: recipient.preferences,
    },
  });
});

/**
 * Get notification settings
 */
app.get('/notify/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  const recipient = await getRecipient(walletId);
  
  if (!recipient) {
    return c.json({ error: 'Not registered for notifications' }, 404);
  }
  
  return c.json({
    walletId: recipient.walletId,
    telegram: recipient.telegram ? { linked: true } : undefined,
    webhook: recipient.webhook ? { linked: true, url: recipient.webhook.url } : undefined,
    preferences: recipient.preferences,
  });
});

/**
 * Send positions report with action buttons
 */
app.post('/notify/:walletId/positions', async (c) => {
  const walletId = c.req.param('walletId');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
  }
  
  // Get recipient
  const recipient = await getRecipient(walletId);
  if (!recipient?.telegram?.chatId) {
    return c.json({ error: 'No Telegram linked for this wallet' }, 400);
  }
  
  // Get wallet address from user profile
  const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
  
  // Look up wallet address from Privy
  let walletAddress: string;
  try {
    const { wallet } = await loadWalletById(walletId);
    walletAddress = wallet.address;
  } catch (e: any) {
    return c.json({ error: 'Wallet not found', details: e.message }, 404);
  }
  
  // Fetch positions using universal discovery
  const positions = await discoverAllPositions(conn, walletAddress);
  
  if (positions.length === 0) {
    const text = [
      `📊 *No LP Positions Found*`,
      ``,
      `Wallet: \`${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}\``,
      ``,
      `You don't have any Meteora DLMM positions yet.`,
      ``,
      `Use /balance to check your SOL balance.`,
    ].join('\n');
    
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipient.telegram.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
    
    return c.json({ success: true, positions: 0 });
  }
  
  // Format positions message
  const positionLines = positions.map((p: any) => {
    const status = p.inRange ? '🟢' : '🔴';
    const priceDisplay = p.priceRange?.currentPrice 
      ? `$${p.priceRange.currentPrice < 1 ? p.priceRange.currentPrice.toFixed(4) : p.priceRange.currentPrice.toFixed(2)}`
      : 'N/A';
    const rangeDisplay = p.priceRange?.display || 'Unknown';
    
    const feesX = p.fees?.tokenXFormatted || '0';
    const feesY = p.fees?.tokenYFormatted || '0';
    
    return [
      `${status} *${p.pool?.name || 'Unknown Pool'}* — ${p.inRange ? 'IN RANGE ✅' : 'OUT OF RANGE ⚠️'}`,
      `📍 Price: ${priceDisplay} (${rangeDisplay.split(' ')[0]} - ${rangeDisplay.split(' ')[2]})`,
      `💎 Fees: ${feesX} + ${feesY}`,
    ].join('\n');
  }).join('\n\n');
  
  const text = [
    `📊 *Your LP Positions*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    positionLines,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⏱ Monitoring: Every 5 min`,
    `🔔 Alerts: Active`,
  ].join('\n');
  
  // Build inline keyboard with buttons
  const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  
  // Add Solscan links for each position
  const solscanRow = positions.slice(0, 2).map((p: any) => ({
    text: `🔍 ${p.pool?.name || 'View'}`,
    url: `https://solscan.io/account/${p.address}`,
  }));
  if (solscanRow.length > 0) buttons.push(solscanRow);
  
  // Action buttons
  buttons.push([
    { text: '💸 Claim Fees', callback_data: 'claim_fees' },
    { text: '🔄 Rebalance', callback_data: 'rebalance' },
  ]);
  buttons.push([
    { text: '📈 Add LP', callback_data: 'add_lp' },
    { text: '📉 Withdraw', callback_data: 'withdraw' },
  ]);
  buttons.push([
    { text: '💰 Balance', callback_data: 'balance' },
    { text: '⚙️ Settings', callback_data: 'settings' },
  ]);
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: recipient.telegram.chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }),
  });
  
  const data = await response.json() as any;
  
  return c.json({
    success: data.ok,
    positions: positions.length,
    error: data.ok ? undefined : data.description,
  });
});

/**
 * Test notification delivery
 */
app.post('/notify/:walletId/test', async (c) => {
  const walletId = c.req.param('walletId');
  
  const testPayload: AlertPayload = {
    event: 'out_of_range',
    walletId,
    timestamp: new Date().toISOString(),
    position: {
      address: 'test-position',
      poolName: 'TEST-POOL',
      poolAddress: 'test-pool-address',
    },
    details: {
      message: '🧪 This is a test notification from LP Agent Toolkit',
      currentBin: 100,
      binRange: { lower: 90, upper: 110 },
      direction: 'above',
      distance: 5,
    },
    action: {
      suggested: 'rebalance',
      endpoint: 'POST /lp/rebalance/execute',
      method: 'POST',
      params: { walletId, positionAddress: 'test' },
    },
  };
  
  const results = await sendAlert(walletId, testPayload);
  
  return c.json({
    success: results.telegram?.success || results.webhook?.success || false,
    results,
  });
});

/**
 * Handle natural language messages
 * Parses intent and either executes directly or relays to user's webhook (OpenClaw)
 */
async function handleNaturalLanguage(
  chatId: number | string,
  text: string,
  user: any,
  botToken: string
): Promise<boolean> {
  const lower = text.toLowerCase();
  
  // Quick intent detection
  const intents: Array<{ pattern: RegExp; handler: () => Promise<string | { text: string; buttons?: any[][] }> }> = [
    // Balance check
    {
      pattern: /balance|how much|what.*have/i,
      handler: async () => handleBalance(chatId),
    },
    // View positions
    {
      pattern: /position|my lp|portfolio|holdings/i,
      handler: async () => handlePositions(chatId),
    },
    // View pools
    {
      pattern: /pool|top pool|best pool|where.*lp|apy/i,
      handler: async () => handlePools(chatId),
    },
    // LP intent: "LP 0.5 SOL into SOL-USDC" or "add liquidity"
    {
      pattern: /lp\s+(\d+\.?\d*)\s*(sol)?|add.*liquidity|provide.*liquidity/i,
      handler: async () => {
        const amountMatch = text.match(/(\d+\.?\d*)\s*sol/i);
        const amount = amountMatch ? amountMatch[1] : '0.5';
        // Default to SOL-USDC pool
        return handleLpAmountPrompt('BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE', 'SOL-USDC');
      },
    },
    // Withdraw
    {
      pattern: /withdraw|pull out|exit|remove.*liquidity/i,
      handler: async () => handleWithdraw(chatId),
    },
    // Claim fees
    {
      pattern: /claim|fees|collect/i,
      handler: async () => ({
        text: `💸 *Claiming Fees...*\n\n🔐 Encrypting with Arcium...\n⚡ Building Jito bundle...\n\nI'll notify you when complete!`,
      }),
    },
    // Deposit
    {
      pattern: /deposit|fund|send.*sol/i,
      handler: async () => handleDeposit(chatId),
    },
  ];
  
  // Try each intent
  for (const { pattern, handler } of intents) {
    if (pattern.test(text)) {
      const result = await handler();
      
      // Send response
      if (typeof result === 'string') {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: result,
            parse_mode: 'Markdown',
          }),
        });
      } else if (result.buttons) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: result.text,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: result.buttons },
          }),
        });
      }
      return true;
    }
  }
  
  // Check if user has a webhook configured for advanced NL (OpenClaw relay)
  const recipient = await getRecipient(user.walletId);
  if (recipient?.webhook?.url) {
    try {
      // Relay to user's OpenClaw/agent
      const payload = {
        event: 'natural_language',
        chatId,
        walletId: user.walletId,
        message: text,
        timestamp: new Date().toISOString(),
        replyEndpoint: `https://lp-agent-api-production.up.railway.app/telegram/send`,
      };
      
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'MnM-LP-Toolkit/1.0',
      };
      
      // Add HMAC signature if secret provided
      if (recipient.webhook.secret) {
        const crypto = await import('crypto');
        const signature = crypto.createHmac('sha256', recipient.webhook.secret).update(body).digest('hex');
        headers['X-Signature'] = `sha256=${signature}`;
      }
      
      await fetch(recipient.webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });
      
      // Send "thinking" message
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🤔 Processing your request...`,
          parse_mode: 'Markdown',
        }),
      });
      
      return true;
    } catch (e) {
      // Webhook failed, fall through to default response
    }
  }
  
  return false; // No intent matched
}

/**
 * Telegram webhook endpoint (receives updates from Telegram)
 */
app.post('/telegram/webhook', async (c) => {
  const update = await c.req.json();
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return c.json({ ok: false, error: 'Bot token not configured' });
  }
  
  try {
    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    const text = update.message?.text || '';
    const username = update.message?.from?.username;
    
    let response = '';
    
    // Handle text commands
    if (update.message?.text) {
      const command = text.split(' ')[0].toLowerCase();
      
      switch (command) {
        case '/start':
          response = await handleStart(chatId, username);
          break;
        case '/link':
          // /link <walletId> - Link existing wallet
          const walletIdArg = text.split(' ')[1];
          if (!walletIdArg) {
            response = [
              `🔗 *Link Existing Wallet*`,
              ``,
              `Usage: \`/link <walletId>\``,
              ``,
              `Your walletId was returned when you created the wallet via API.`,
            ].join('\n');
          } else {
            response = await handleLink(chatId, walletIdArg.trim(), username);
          }
          break;
        case '/balance':
          response = await handleBalance(chatId);
          break;
        case '/positions': {
          const posResult = await handlePositions(chatId);
          if (posResult.buttons) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: posResult.text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: posResult.buttons },
              }),
            });
            return c.json({ ok: true });
          }
          response = posResult.text;
          break;
        }
        case '/status':
          // Redirect to /positions for full overview
          response = `ℹ️ Use /positions for full portfolio view, or /balance for wallet balance.`;
          break;
        case '/deposit':
          response = await handleDeposit(chatId);
          break;
        case '/withdraw': {
          const withdrawResult = await handleWithdraw(chatId);
          if (withdrawResult.buttons) {
            // Send with buttons
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: withdrawResult.text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: withdrawResult.buttons },
              }),
            });
            return c.json({ ok: true });
          }
          response = withdrawResult.text;
          break;
        }
        case '/settings': {
          const settingsResult = await handleSettings(chatId);
          if (settingsResult.buttons) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: settingsResult.text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: settingsResult.buttons },
              }),
            });
            return c.json({ ok: true });
          }
          response = settingsResult.text;
          break;
        }
        case '/pools': {
          const poolsResult = await handlePools(chatId);
          if (poolsResult.buttons) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: poolsResult.text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: poolsResult.buttons },
              }),
            });
            return c.json({ ok: true });
          }
          response = poolsResult.text;
          break;
        }
        case '/help':
          response = [
            `🤖 *MnM LP Toolkit Commands*`,
            ``,
            `/start - Create wallet or show existing`,
            `/balance - Check wallet balance`,
            `/pools - Browse top LP pools`,
            `/positions - View your LP positions`,
            `/deposit - Get deposit address`,
            `/withdraw - Withdraw funds`,
            `/settings - Alert preferences`,
            `/help - This message`,
            ``,
            `🔐 All transactions encrypted with *Arcium*`,
            `⚡ MEV-protected via *Jito bundles*`,
            ``,
            `_Docs: api.mnm.ag_`,
          ].join('\n');
          break;
        default:
          // Natural language handling
          const user = await getUserByChat(chatId);
          if (!user) {
            response = `👋 Hi! Use /start to create your wallet.`;
          } else {
            // Try to parse natural language intent
            const nlResponse = await handleNaturalLanguage(chatId, text, user, botToken);
            if (nlResponse) {
              return c.json({ ok: true }); // Response already sent
            }
            response = `I didn't understand that. Try /help for commands, or be more specific like "LP 0.5 SOL into SOL-USDC"`;
          }
      }
      
      // Send response
      if (response) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: response,
            parse_mode: 'Markdown',
          }),
        });
      }
    }
    
    // Handle callback queries (button presses)
    if (update.callback_query) {
      const data = update.callback_query.data;
      const callbackId = update.callback_query.id;
      
      if (chatId && data) {
        response = await handleTelegramCallback(chatId, data);
        
        // Answer callback query
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackId,
            text: 'Processing...',
          }),
        });
        
        // Check for special multi-step prompts
        if (response.startsWith('LP_AMOUNT_PROMPT:')) {
          const [, poolAddress, poolName] = response.split(':');
          const prompt = handleLpAmountPrompt(poolAddress, poolName);
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: prompt.text,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: prompt.buttons },
            }),
          });
          return c.json({ ok: true });
        }
        
        if (response.startsWith('LP_STRATEGY_PROMPT:')) {
          const [, poolAddress, amount] = response.split(':');
          const prompt = handleLpStrategyPrompt(poolAddress, amount);
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: prompt.text,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: prompt.buttons },
            }),
          });
          return c.json({ ok: true });
        }
        
        // Send regular response message
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: response,
            parse_mode: 'Markdown',
          }),
        });
        return c.json({ ok: true });
      }
    }
    
    return c.json({ ok: true });
  } catch (error: any) {
    console.error('[Telegram Webhook] Error:', error);
    return c.json({ ok: false, error: error.message });
  }
});

/**
 * Get Telegram bot info and verify commands
 */
app.get('/telegram/info', async (c) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
  }
  
  try {
    // Get bot info
    const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meResponse.json() as any;
    
    // Get current commands
    const cmdResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMyCommands`);
    const cmdData = await cmdResponse.json() as any;
    
    return c.json({
      success: true,
      bot: meData.ok ? {
        id: meData.result.id,
        username: meData.result.username,
        name: meData.result.first_name,
      } : null,
      commands: cmdData.ok ? cmdData.result : [],
      commandsCount: cmdData.ok ? cmdData.result.length : 0,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Set up Telegram bot commands menu
 */
app.post('/telegram/commands', async (c) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
  }
  
  const commands = [
    { command: 'start', description: '🚀 Create wallet or show existing' },
    { command: 'balance', description: '💰 Check wallet balance & tokens' },
    { command: 'pools', description: '🏊 Browse top LP pools' },
    { command: 'positions', description: '📊 View your LP positions' },
    { command: 'deposit', description: '💳 Get deposit address' },
    { command: 'withdraw', description: '📤 Withdraw funds' },
    { command: 'settings', description: '⚙️ Alert preferences' },
    { command: 'help', description: '❓ Show all commands' },
  ];
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    
    const data = await response.json() as any;
    
    if (data.ok) {
      return c.json({ success: true, message: 'Bot commands menu set', commands });
    } else {
      return c.json({ success: false, error: data.description }, 400);
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Set up Telegram webhook URL
 */
app.post('/telegram/setup', async (c) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
  }
  
  // Get the webhook URL from request or auto-detect
  const body = await c.req.json().catch(() => ({}));
  const webhookUrl = body.url || `https://lp-agent-api-production.up.railway.app/telegram/webhook`;
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
      }),
    });
    
    const data = await response.json() as any;
    
    if (data.ok) {
      return c.json({
        success: true,
        message: 'Telegram webhook configured',
        webhookUrl,
      });
    } else {
      return c.json({ success: false, error: data.description }, 400);
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Send message to a user via Telegram (for OpenClaw/agents to reply)
 */
app.post('/telegram/send', async (c) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
  }
  
  try {
    const body = await c.req.json();
    const { chatId, message, buttons, parseMode = 'Markdown' } = body;
    
    if (!chatId || !message) {
      return c.json({ error: 'Missing chatId or message' }, 400);
    }
    
    const payload: any = {
      chat_id: chatId,
      text: message,
      parse_mode: parseMode,
    };
    
    if (buttons && Array.isArray(buttons)) {
      payload.reply_markup = { inline_keyboard: buttons };
    }
    
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await response.json() as any;
    
    return c.json({
      success: data.ok,
      messageId: data.result?.message_id,
      error: data.ok ? undefined : data.description,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Serve the skill file for OpenClaw agents
 */
app.get('/skill.md', async (c) => {
  const skillContent = `---
name: lp-agent
description: "Manage Solana LP positions via MnM LP Agent Toolkit. Create wallets, browse pools, add/remove liquidity, monitor positions, claim fees. All transactions Arcium-encrypted and Jito-bundled."
---

# LP Agent Skill

Manage Solana LP positions with natural language. All transactions are Arcium-encrypted and MEV-protected via Jito bundles.

## API Base
\`https://lp-agent-api-production.up.railway.app\`

## Quick Commands

| User Says | Endpoint | Example |
|-----------|----------|---------|
| "Create wallet" | POST /wallet/create | Returns walletId |
| "Check balance" | GET /wallet/:id/balance | SOL + tokens |
| "Show pools" | GET /pools/top | Top pools by TVL |
| "LP X SOL" | POST /lp/atomic | Atomic swap+LP |
| "My positions" | GET /positions/:id | All LP positions |
| "Withdraw" | POST /lp/withdraw/atomic | Atomic withdraw |
| "Claim fees" | POST /fees/claim | Collect LP fees |

## Key Endpoints

### Create Wallet
\`\`\`bash
curl -X POST "https://lp-agent-api-production.up.railway.app/wallet/create"
\`\`\`

### Add Liquidity (Atomic)
\`\`\`bash
curl -X POST "https://lp-agent-api-production.up.railway.app/lp/atomic" \\
  -H "Content-Type: application/json" \\
  -d '{"walletId":"ID","poolAddress":"POOL","amountSol":0.5,"strategy":"concentrated"}'
\`\`\`

### View Positions
\`\`\`bash
curl "https://lp-agent-api-production.up.railway.app/positions/WALLET_ID"
\`\`\`

### Withdraw (Atomic)
\`\`\`bash
curl -X POST "https://lp-agent-api-production.up.railway.app/lp/withdraw/atomic" \\
  -H "Content-Type: application/json" \\
  -d '{"walletId":"ID","poolAddress":"POOL","positionAddress":"POS","convertToSol":true}'
\`\`\`

## Telegram Bot
Users can also use @mnm_lp_bot for the same actions with a button interface.

## Security
- Privy MPC wallets (keys never exposed)
- Arcium-encrypted strategies
- Jito MEV-protected bundles
`;

  c.header('Content-Type', 'text/markdown');
  return c.text(skillContent);
});

/**
 * OpenClaw integration setup guide
 */
app.get('/openclaw/setup', async (c) => {
  const walletId = c.req.query('walletId');
  
  return c.json({
    title: '🔗 Connect LP Agent to OpenClaw',
    description: 'Enable natural language LP management through your Clawdbot',
    
    steps: [
      {
        step: 1,
        title: 'Install the LP Agent Skill',
        action: 'Add to your OpenClaw skills directory',
        command: `curl -o ~/.openclaw/skills/lp-agent/SKILL.md https://lp-agent-api-production.up.railway.app/skill.md`,
      },
      {
        step: 2,
        title: 'Configure your wallet',
        action: 'Set environment variables in OpenClaw config',
        config: {
          LP_AGENT_API: 'https://lp-agent-api-production.up.railway.app',
          LP_WALLET_ID: walletId || '<your-wallet-id>',
        },
      },
      {
        step: 3,
        title: 'Register webhook for two-way sync',
        action: 'Connect LP Bot to your OpenClaw gateway',
        command: walletId ? `curl -X POST "${c.req.url.split('/openclaw')[0]}/notify/register" -H "Content-Type: application/json" -d '{"walletId":"${walletId}","webhook":{"url":"http://localhost:18789/webhook/lp-agent"}}'` : 'First create a wallet with POST /wallet/create',
      },
      {
        step: 4,
        title: 'Test the integration',
        action: 'Try natural language in terminal or Telegram',
        examples: [
          'Tell Clawdbot: "LP 0.5 SOL into the best pool"',
          'Tell @mnm_lp_bot: "Check my positions"',
          'Both should work seamlessly!',
        ],
      },
    ],
    
    skillUrl: 'https://lp-agent-api-production.up.railway.app/skill.md',
    docsUrl: 'https://api.mnm.ag',
    telegramBot: '@mnm_lp_bot',
  });
});

/**
 * Auto-setup OpenClaw integration (creates webhook, returns config)
 */
app.post('/openclaw/connect', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, openclawGateway } = body;
    
    if (!walletId) {
      return c.json({ 
        error: 'Missing walletId',
        hint: 'First create a wallet with POST /wallet/create',
      }, 400);
    }
    
    // Default to local OpenClaw gateway
    const gatewayUrl = openclawGateway || 'http://localhost:18789';
    
    // Register webhook for NL relay
    await upsertRecipient({
      walletId,
      webhook: {
        url: `${gatewayUrl}/webhook/lp-agent`,
        secret: `lp-${walletId.slice(0, 8)}`,
        linkedAt: new Date().toISOString(),
      },
    });
    
    return c.json({
      success: true,
      message: '🔗 OpenClaw connected!',
      
      config: {
        addToOpenclawConfig: {
          'env.LP_AGENT_API': 'https://lp-agent-api-production.up.railway.app',
          'env.LP_WALLET_ID': walletId,
        },
      },
      
      webhookRegistered: {
        url: `${gatewayUrl}/webhook/lp-agent`,
        events: ['natural_language', 'alerts'],
      },
      
      nextSteps: [
        '1. Copy the skill file: curl -o ~/.openclaw/skills/lp-agent/SKILL.md https://lp-agent-api-production.up.railway.app/skill.md',
        '2. Restart OpenClaw to load the skill',
        '3. Try: "LP 0.5 SOL into SOL-USDC" in terminal or @mnm_lp_bot',
      ],
      
      naturalLanguageExamples: [
        'LP 1 SOL into the best pool',
        'Check my LP positions',
        'Withdraw from my SOL-USDC position',
        'What are the top pools right now?',
        'Claim my fees',
      ],
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ Start ============

const port = parseInt(process.env.PORT || '3456');
console.log(`🚀 LP Agent Toolkit - Starting on port ${port}...`);

// Auto-start worker on boot
startWorker().catch(err => {
  console.error('Failed to start worker:', err);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ Server running on http://0.0.0.0:${info.port}`);
  console.log(`📊 Worker status: ${isWorkerRunning() ? 'RUNNING' : 'STOPPED'}`);
});
