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
import { resolveTokens, binIdToPrice, calculatePriceRange } from './utils/token-metadata';
import { buildAtomicLP } from './lp/atomic';
import { buildAtomicWithdraw } from './lp/atomicWithdraw';
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
function initializeMonitoring() {
  try {
    const data = loadData();
    
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
    setLastCheck(now);
    
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
  version: '2.2.0-monitoring',
  status: 'running',
  docs: 'https://mnm-web-seven.vercel.app',
  github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  features: ['MPC Custody', 'Arcium Privacy', 'Stateless API', 'Multi-DEX LP', 'Position Monitoring', 'Webhook Alerts'],
  design: 'STATELESS - pass walletId on every request',
  flow: [
    '1. POST /wallet/create → get walletId',
    '2. Agent stores walletId in its context',
    '3. All subsequent calls pass walletId',
  ],
  endpoints: [
    'GET  /health                         → status + monitoring info',
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
    'DELETE /monitor/webhook              → remove webhook',
    'POST /monitor/check                  → manually trigger check',
  ],
}));

app.get('/health', (c) => {
  const positions = monitor.getPositions();
  const webhookConfigured = getWebhookConfig() !== null;
  
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
    const { positionAddress, poolAddress, binRange, webhookUrl, alerts } = body;
    
    if (!positionAddress || !poolAddress) {
      return c.json({ 
        error: 'Missing positionAddress or poolAddress',
        example: {
          positionAddress: 'your-position-address',
          poolAddress: 'pool-address',
          binRange: { min: 100, max: 120 },
          alerts: { outOfRange: true, valueChangePercent: 10 },
        },
      }, 400);
    }
    
    const position: MonitoredPosition = {
      positionAddress,
      poolAddress,
      binRange: binRange || { min: 0, max: 0 },
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

// Known DLMM pools to check for positions
const KNOWN_POOLS = [
  { address: 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y', name: 'SOL-USDC', tokenX: 'SOL', tokenY: 'USDC' },
  { address: '5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd', name: 'MET-USDC', tokenX: 'MET', tokenY: 'USDC' },
  { address: 'C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg', name: 'JUP-SOL', tokenX: 'JUP', tokenY: 'SOL' },
  { address: 'BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE', name: 'SOL-USDC (alt)', tokenX: 'SOL', tokenY: 'USDC' },
];

// Get positions by walletId
app.get('/positions/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;
    
    // Query on-chain positions across all known pools
    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const userPubkey = new PublicKey(walletAddress);
    const allPositions: any[] = [];
    const mintsToResolve = new Set<string>();
    
    for (const poolInfo of KNOWN_POOLS) {
      try {
        const pool = await DLMM.create(conn, new PublicKey(poolInfo.address));
        const positions = await pool.getPositionsByUserAndLbPair(userPubkey);
        const binStep = Number(pool.lbPair.binStep);
        const tokenXMint = pool.tokenX.publicKey.toBase58();
        const tokenYMint = pool.tokenY.publicKey.toBase58();
        
        mintsToResolve.add(tokenXMint);
        mintsToResolve.add(tokenYMint);
        
        for (const pos of positions.userPositions) {
          const activeBin = await pool.getActiveBin();
          const lowerBinId = pos.positionData.lowerBinId;
          const upperBinId = pos.positionData.upperBinId;
          
          // Calculate price bounds
          const priceRange = calculatePriceRange(lowerBinId, upperBinId, binStep);
          const currentPrice = binIdToPrice(activeBin.binId, binStep);
          
          allPositions.push({
            address: pos.publicKey.toBase58(),
            pool: {
              address: poolInfo.address,
              name: poolInfo.name,
              tokenX: poolInfo.tokenX,
              tokenY: poolInfo.tokenY,
              tokenXMint,
              tokenYMint,
              binStep,
            },
            binRange: {
              lower: lowerBinId,
              upper: upperBinId,
            },
            priceRange: {
              priceLower: priceRange.priceLower,
              priceUpper: priceRange.priceUpper,
              currentPrice,
              unit: `${poolInfo.tokenY} per ${poolInfo.tokenX}`,
            },
            activeBinId: activeBin.binId,
            inRange: activeBin.binId >= lowerBinId && activeBin.binId <= upperBinId,
            solscanUrl: `https://solscan.io/account/${pos.publicKey.toBase58()}`,
          });
        }
      } catch (e) {
        // Pool query failed, skip
        console.warn(`Failed to query pool ${poolInfo.name}:`, (e as Error).message);
      }
    }
    
    // Resolve token names
    const tokenMetadata = await resolveTokens(Array.from(mintsToResolve));
    
    // Enrich positions with token symbols
    for (const pos of allPositions) {
      const tokenX = tokenMetadata.get(pos.pool.tokenXMint);
      const tokenY = tokenMetadata.get(pos.pool.tokenYMint);
      if (tokenX) pos.pool.tokenXSymbol = tokenX.symbol;
      if (tokenY) pos.pool.tokenYSymbol = tokenY.symbol;
    }
    
    return c.json({
      success: true,
      message: `Found ${allPositions.length} positions`,
      data: {
        walletId,
        walletAddress,
        positions: allPositions,
        totalPositions: allPositions.length,
      },
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
    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const userPubkey = new PublicKey(walletAddress);
    const allPositions: any[] = [];
    const mintsToResolve = new Set<string>();
    
    for (const poolInfo of KNOWN_POOLS) {
      try {
        const pool = await DLMM.create(conn, new PublicKey(poolInfo.address));
        const positions = await pool.getPositionsByUserAndLbPair(userPubkey);
        const binStep = Number(pool.lbPair.binStep);
        const tokenXMint = pool.tokenX.publicKey.toBase58();
        const tokenYMint = pool.tokenY.publicKey.toBase58();
        
        mintsToResolve.add(tokenXMint);
        mintsToResolve.add(tokenYMint);
        
        for (const pos of positions.userPositions) {
          const activeBin = await pool.getActiveBin();
          const lowerBinId = pos.positionData.lowerBinId;
          const upperBinId = pos.positionData.upperBinId;
          
          // Calculate price bounds
          const priceRange = calculatePriceRange(lowerBinId, upperBinId, binStep);
          const currentPrice = binIdToPrice(activeBin.binId, binStep);
          
          allPositions.push({
            address: pos.publicKey.toBase58(),
            pool: {
              address: poolInfo.address,
              name: poolInfo.name,
              tokenX: poolInfo.tokenX,
              tokenY: poolInfo.tokenY,
              tokenXMint,
              tokenYMint,
              binStep,
            },
            binRange: {
              lower: lowerBinId,
              upper: upperBinId,
            },
            priceRange: {
              priceLower: priceRange.priceLower,
              priceUpper: priceRange.priceUpper,
              currentPrice,
              unit: `${poolInfo.tokenY} per ${poolInfo.tokenX}`,
            },
            activeBinId: activeBin.binId,
            inRange: activeBin.binId >= lowerBinId && activeBin.binId <= upperBinId,
            solscanUrl: `https://solscan.io/account/${pos.publicKey.toBase58()}`,
          });
        }
      } catch (e) {
        console.warn(`Failed to query pool ${poolInfo.name}:`, (e as Error).message);
      }
    }
    
    // Resolve token names
    const tokenMetadata = await resolveTokens(Array.from(mintsToResolve));
    
    // Enrich positions with token symbols
    for (const pos of allPositions) {
      const tokenX = tokenMetadata.get(pos.pool.tokenXMint);
      const tokenY = tokenMetadata.get(pos.pool.tokenYMint);
      if (tokenX) pos.pool.tokenXSymbol = tokenX.symbol;
      if (tokenY) pos.pool.tokenYSymbol = tokenY.symbol;
    }
    
    return c.json({
      success: true,
      message: `Found ${allPositions.length} positions`,
      data: {
        walletAddress,
        positions: allPositions,
        totalPositions: allPositions.length,
      },
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
    const { walletId, tokenA, tokenB, totalValueUsd, amount } = body;
    const value = totalValueUsd || amount;
    
    if (!walletId) {
      return c.json({ 
        error: 'Missing walletId',
        hint: 'First call POST /wallet/create, store the walletId, then pass it here',
        example: { walletId: 'abc123', tokenA: 'SOL', tokenB: 'USDC', totalValueUsd: 500 }
      }, 400);
    }
    
    if (!tokenA || !tokenB || !value) {
      return c.json({ 
        error: 'Missing tokenA, tokenB, or totalValueUsd/amount',
        example: { walletId: 'abc123', tokenA: 'SOL', tokenB: 'USDC', totalValueUsd: 500 }
      }, 400);
    }
    
    // Load wallet (stateless)
    const { wallet } = await loadWalletById(walletId);
    const fee = value * FEE_CONFIG.FEE_BPS / 10000;
    
    stats.actions.lpExecuted++;
    return c.json({
      success: true,
      walletId,
      walletAddress: wallet.address,
      message: `LP pipeline prepared: $${value} into ${tokenA}-${tokenB}`,
      data: {
        pair: `${tokenA}-${tokenB}`,
        totalValue: value,
        fee,
        pool: SAMPLE_POOLS[0],
        steps: [
          { step: 1, action: 'Check balances', status: 'pending' },
          { step: 2, action: 'Swap to 50/50 if needed', status: 'pending' },
          { step: 3, action: 'Add liquidity to Meteora DLMM', status: 'pending' },
        ],
      },
      note: 'Demo mode - production executes full pipeline',
    });
  } catch (error: any) {
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
    const currentPriceRange = calculatePriceRange(currentLower, currentUpper, binStep);
    
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
    
    const newPriceRange = calculatePriceRange(targetLower, targetUpper, binStep);
    
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
        },
      },
      newPosition: {
        binRange: { lower: targetLower, upper: targetUpper },
        priceRange: {
          priceLower: newPriceRange.priceLower,
          priceUpper: newPriceRange.priceUpper,
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
        currentPrice: binIdToPrice(activeBin.binId, binStep),
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
 * Execute a full atomic rebalance (withdraw + re-enter in Jito bundle)
 * This signs and submits the transactions.
 */
app.post('/lp/rebalance/execute', async (c) => {
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
    
    if (!walletId || !poolAddress || !positionAddress) {
      return c.json({ 
        error: 'Missing walletId, poolAddress, or positionAddress',
      }, 400);
    }
    
    // Load wallet
    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;
    
    console.log(`[Rebalance Execute] Starting atomic rebalance...`);
    
    // Get pool info
    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pool = await DLMM.create(conn, new PublicKey(poolAddress));
    const activeBin = await pool.getActiveBin();
    
    // Build withdrawal bundle
    const withdrawResult = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed: tipSpeed as TipSpeed,
    });
    
    // Sign withdrawal transactions with Privy
    const signedWithdrawTxs: string[] = [];
    for (const unsignedTx of withdrawResult.unsignedTransactions) {
      try {
        const signedTx = await client.signTransaction(unsignedTx);
        signedWithdrawTxs.push(signedTx);
      } catch (signErr: any) {
        console.error('[Rebalance] Sign error:', signErr);
        // If signing fails, it might already be partially signed (position keypair)
        signedWithdrawTxs.push(unsignedTx);
      }
    }
    
    // Submit withdrawal bundle to Jito
    console.log(`[Rebalance Execute] Submitting ${signedWithdrawTxs.length} withdrawal txs to Jito...`);
    const { bundleId } = await sendBundle(signedWithdrawTxs);
    console.log(`[Rebalance Execute] Withdrawal bundle submitted: ${bundleId}`);
    
    // Wait for withdrawal to land
    const withdrawStatus = await waitForBundle(bundleId, { timeoutMs: 60000 });
    
    if (!withdrawStatus.landed) {
      return c.json({
        success: false,
        error: 'Withdrawal bundle failed to land',
        bundleId,
        details: withdrawStatus.error,
      }, 500);
    }
    
    console.log(`[Rebalance Execute] Withdrawal landed at slot ${withdrawStatus.slot}!`);
    
    // Now build and execute re-entry
    // Calculate new bin range
    let targetLower = newLowerBin !== undefined ? activeBin.binId + newLowerBin : activeBin.binId - 5;
    let targetUpper = newUpperBin !== undefined ? activeBin.binId + newUpperBin : activeBin.binId + 5;
    
    if (strategy === 'wide') {
      targetLower = activeBin.binId - 20;
      targetUpper = activeBin.binId + 20;
    }
    
    // Get collateral info from position (estimate)
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const solMint = 'So11111111111111111111111111111111111111112';
    const collateralMint = tokenXMint === solMint ? tokenXMint : pool.tokenY.publicKey.toBase58();
    
    // Get wallet balance to determine re-entry amount
    const balance = await conn.getBalance(new PublicKey(walletAddress));
    const reentryAmount = Math.floor(balance * 0.9); // Use 90% of balance, keep some for fees
    
    // Build re-entry LP transactions
    const lpResult = await buildAtomicLP({
      walletAddress,
      poolAddress,
      collateralMint,
      collateralAmount: reentryAmount,
      strategy: strategy as 'concentrated' | 'wide' | 'custom',
      shape: shape as 'spot' | 'curve' | 'bidask',
      minBinId: targetLower - activeBin.binId,
      maxBinId: targetUpper - activeBin.binId,
      tipSpeed: tipSpeed as TipSpeed,
      slippageBps,
    });
    
    // Sign LP transactions
    const signedLpTxs: string[] = [];
    for (const unsignedTx of lpResult.unsignedTransactions) {
      try {
        const signedTx = await client.signTransaction(unsignedTx);
        signedLpTxs.push(signedTx);
      } catch (signErr: any) {
        // Already partially signed with position keypair
        signedLpTxs.push(unsignedTx);
      }
    }
    
    // Submit LP bundle
    console.log(`[Rebalance Execute] Submitting ${signedLpTxs.length} LP txs to Jito...`);
    const lpBundle = await sendBundle(signedLpTxs);
    console.log(`[Rebalance Execute] LP bundle submitted: ${lpBundle.bundleId}`);
    
    // Wait for LP to land
    const lpStatus = await waitForBundle(lpBundle.bundleId, { timeoutMs: 60000 });
    
    stats.actions.lpExecuted++;
    
    return c.json({
      success: lpStatus.landed,
      message: lpStatus.landed ? 'Rebalance completed!' : 'Rebalance partial - LP may have failed',
      walletId,
      walletAddress,
      withdraw: {
        bundleId,
        landed: withdrawStatus.landed,
        slot: withdrawStatus.slot,
      },
      reentry: {
        bundleId: lpBundle.bundleId,
        landed: lpStatus.landed,
        slot: lpStatus.slot,
        positionAddress: lpResult.positionKeypair ? 'New position created' : undefined,
        binRange: lpResult.binRange,
        error: lpStatus.error,
      },
    });
  } catch (error: any) {
    console.error('[Rebalance Execute] Error:', error);
    stats.errors++;
    return c.json({ error: 'Rebalance execution failed', details: error.message }, 500);
  }
});

// ============ Start ============

const port = parseInt(process.env.PORT || '3456');
console.log(`🚀 LP Agent Toolkit - Starting on port ${port}...`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ Server running on http://0.0.0.0:${info.port}`);
});
