/**
 * Health & Stats Routes
 */
import { Hono } from 'hono';
import { config } from '../config/index.js';
import {
  getPositionMonitor,
  getWebhookConfig,
  getStorageInfo,
} from '../monitoring/index.js';
import { stats } from '../services/stats.js';
import { getBot } from '../bot/index.js';
import { getCircuitBreakerStatus } from '../services/ultra-swap.js';

const app = new Hono();

const monitor = getPositionMonitor(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '2.4.0-redis-persistence',
  status: 'running',
  docs: 'https://mnm-web-seven.vercel.app',
  github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  features: ['MPC Custody', 'Arcium Privacy', 'Stateless API', 'Multi-DEX LP', 'Position Monitoring', 'Webhook Alerts', 'Redis Persistence', 'Multi-Oracle Pricing', 'MEV-Protected Swaps', 'MCP Server', 'Dynamic Priority Fees'],
  design: 'STATELESS - pass walletId on every request',
  flow: [
    '1. POST /wallet/create -> get walletId',
    '2. Agent stores walletId in its context',
    '3. All subsequent calls pass walletId',
  ],
  endpoints: [
    'GET  /health                         -> status + monitoring info + storage type',
    'GET  /fees',
    'GET  /fees/calculate?amount=1000',
    'GET  /pools/scan?tokenA=SOL&tokenB=USDC',
    'GET  /pools/top?limit=5&riskMax=7    -> top pools with risk scoring',
    'GET  /pools/:address/risk            -> risk assessment for a pool',
    'POST /encrypt',
    'GET  /encrypt/info',
    'POST /wallet/create                  -> returns walletId',
    'GET  /wallet/:walletId               -> wallet info',
    'GET  /wallet/:walletId/balance       -> balance',
    'POST /lp/open    { walletId, ... }   -> open position',
    'POST /lp/close   { walletId, ... }   -> close position',
    'POST /lp/execute { walletId, ... }   -> full pipeline',
    'POST /lp/withdraw  { walletAddress, poolAddress, positionAddress } -> withdraw with PnL',
    'POST /lp/withdraw/atomic { ..., convertToSol } -> atomic withdrawal via Jito',
    'POST /fees/claim { walletAddress, poolAddress, positionAddress } -> claim fees only',
    'POST /fees/compound { ... } -> claim + instructions to re-add',
    'POST /lp/rebalance { walletId, poolAddress, positionAddress, ... } -> prepare rebalance',
    'POST /lp/rebalance/execute { ... }   -> execute atomic rebalance',
    'GET  /positions/:walletId            -> list positions (with token names & prices)',
    'GET  /positions?address=...          -> list positions by address',
    'GET  /positions/:walletId/risk       -> risk assessment for all positions',
    'GET  /risk/volatility/:symbol        -> token volatility data',
    'POST /chat       { message, walletId? }',
    '--- Monitoring ---',
    'POST /monitor/add                    -> add position to monitor',
    'DELETE /monitor/remove/:address      -> stop tracking position',
    'GET  /monitor/positions              -> list all monitored positions',
    'GET  /monitor/status/:address        -> get current status of position',
    'POST /monitor/webhook                -> configure webhook for alerts',
    'GET  /monitor/webhook                -> get webhook config',
    'POST /monitor/webhook/test           -> send test alert to webhook',
    'DELETE /monitor/webhook              -> remove webhook',
    'POST /monitor/check                  -> manually trigger check',
    '--- Oracle ---',
    'GET  /oracle/price?mint=<address>    -> aggregated price (Pyth + Jupiter)',
    'POST /oracle/prices { mints: [...] } -> batch prices',
    '--- Ultra Swap (MEV-Protected) ---',
    'POST /ultra/order { inputToken, outputToken, amount, walletAddress } -> create MEV-protected order',
    'POST /ultra/execute { requestId, signedTransaction } -> execute signed order',
  ],
}));

app.get('/health', async (c) => {
  const positions = monitor.getPositions();
  const webhookConfigured = getWebhookConfig() !== null;
  const storageInfo = getStorageInfo();
  const circuitBreaker = getCircuitBreakerStatus();
  
  // Check Telegram bot connectivity
  let telegramStatus: { connected: boolean; username?: string; error?: string } = { connected: false };
  try {
    const bot = getBot();
    if (bot) {
      const me = await bot.api.getMe();
      telegramStatus = { connected: true, username: me.username };
    } else {
      telegramStatus = { connected: false, error: 'Bot not initialized' };
    }
  } catch (err) {
    telegramStatus = { connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    monitoring: {
      enabled: true,
      positionsTracked: positions.length,
      webhookConfigured,
      lastCheck: null,
      intervalMs: parseInt(process.env.MONITOR_INTERVAL_MS || '300000'),
    },
    storage: {
      type: storageInfo.type,
      redisAvailable: storageInfo.available,
    },
    telegram: telegramStatus,
    circuitBreakers: {
      jupiterUltra: circuitBreaker,
    },
  });
});

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

// Quick Telegram bot health check
app.get('/health/telegram', async (c) => {
  try {
    const bot = getBot();
    if (!bot) {
      return c.json({ status: 'error', error: 'Bot not initialized' }, 503);
    }
    
    const startTime = Date.now();
    const me = await bot.api.getMe();
    const latencyMs = Date.now() - startTime;
    
    return c.json({
      status: 'ok',
      bot: {
        id: me.id,
        username: me.username,
        firstName: me.first_name,
      },
      latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, 503);
  }
});

// Circuit breaker status
app.get('/health/circuit-breakers', (c) => {
  return c.json({
    jupiterUltra: getCircuitBreakerStatus(),
    timestamp: new Date().toISOString(),
  });
});

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

export default app;
