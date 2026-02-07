/**
 * Monitor Routes - Position monitoring, webhooks, alerts
 */
import { Hono } from 'hono';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config/index.js';
import { stats } from '../services/stats.js';
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
} from '../monitoring/index.js';
import { getPositionBinRange, getPoolInfo } from '../utils/position-discovery.js';
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
} from '../monitoring/index.js';
import { getTokenVolatility } from '../risk/index.js';

const app = new Hono();

const monitor = getPositionMonitor(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');

// Monitoring state
const monitoringState = {
  enabled: true,
  lastCheck: null as string | null,
  intervalId: null as NodeJS.Timeout | null,
};

// Run monitoring check
export async function runMonitoringCheck(): Promise<AlertResult[]> {
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

// Initialize monitoring on startup
export async function initializeMonitoring() {
  try {
    const storageInfo = getStorageInfo();
    console.log(`[Persistence] Storage type: ${storageInfo.type} (available: ${storageInfo.available})`);

    const data = await loadData();

    for (const position of data.positions) {
      monitor.addPosition(position);
    }

    if (data.webhook) {
      setWebhookConfig(data.webhook);
    }

    if (data.lastCheck) {
      monitoringState.lastCheck = data.lastCheck;
    }

    console.log(`Monitoring initialized: ${data.positions.length} positions, webhook: ${data.webhook ? 'configured' : 'none'}`);
  } catch (e) {
    console.warn('Failed to initialize monitoring:', (e as Error).message);
  }
}

// Start background polling
export function startMonitoringInterval() {
  const MONITOR_INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '300000');
  if (MONITOR_INTERVAL_MS > 0) {
    console.log(`Background monitoring enabled (interval: ${MONITOR_INTERVAL_MS}ms)`);
    monitoringState.intervalId = setInterval(runMonitoringCheck, MONITOR_INTERVAL_MS);
  } else {
    console.log('Background monitoring disabled (MONITOR_INTERVAL_MS=0)');
    monitoringState.enabled = false;
  }
}

// --- Position monitoring endpoints ---

app.post('/add', async (c) => {
  try {
    const body = await c.req.json();
    const { positionAddress, poolAddress, walletAddress, binRange, webhookUrl, alerts } = body;

    if (!positionAddress || !poolAddress) {
      return c.json({
        error: 'Missing positionAddress or poolAddress',
        example: {
          positionAddress: 'your-position-address',
          poolAddress: 'pool-address',
          walletAddress: 'wallet-address (optional)',
          binRange: { min: 100, max: 120 },
          alerts: { outOfRange: true, valueChangePercent: 10 },
        },
      }, 400);
    }

    let actualBinRange = binRange;
    let poolInfo = null;

    if (!binRange || (binRange.min === 0 && binRange.max === 0)) {
      if (walletAddress) {
        const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
        const discoveredRange = await getPositionBinRange(conn, poolAddress, positionAddress, walletAddress);

        if (discoveredRange) {
          actualBinRange = discoveredRange;
        } else {
          actualBinRange = { min: 0, max: 0 };
        }

        poolInfo = await getPoolInfo(conn, poolAddress);
      } else {
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

    monitor.addPosition(position);
    persistAddPosition(position);

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

app.delete('/remove/:positionAddress', (c) => {
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

app.get('/positions', (c) => {
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

app.get('/status/:positionAddress', async (c) => {
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

app.post('/webhook', async (c) => {
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

app.delete('/webhook', (c) => {
  setWebhookConfig(null);
  persistSetWebhook(null);
  return c.json({ success: true, message: 'Webhook removed' });
});

app.get('/webhook', (c) => {
  const webhookCfg = getWebhookConfig();

  if (!webhookCfg) {
    return c.json({ success: true, configured: false, webhook: null });
  }

  return c.json({
    success: true,
    configured: true,
    webhook: {
      url: webhookCfg.url,
      hasSecret: !!webhookCfg.secret,
      events: webhookCfg.events,
      lastDelivery: webhookCfg.lastDelivery || null,
      stats: webhookCfg.deliveryStats,
    },
  });
});

app.post('/webhook/test', async (c) => {
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
      message: result.success ? 'Test alert delivered successfully!' : 'Test alert delivery failed',
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
        message: 'This is a test alert from LP Toolkit',
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

app.post('/check', async (c) => {
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

export default app;

// --- Worker & User management routes ---
export function workerRoutes() {
  const wApp = new Hono();

  wApp.get('/status', async (c) => {
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

  wApp.post('/start', async (c) => {
    if (isWorkerRunning()) {
      return c.json({ success: false, message: 'Worker already running' });
    }
    await startWorker();
    return c.json({ success: true, message: 'Worker started' });
  });

  wApp.post('/stop', async (c) => {
    if (!isWorkerRunning()) {
      return c.json({ success: false, message: 'Worker not running' });
    }
    await stopWorker();
    return c.json({ success: true, message: 'Worker stopped' });
  });

  wApp.post('/check', async (c) => {
    await triggerPositionCheck();
    return c.json({ success: true, message: 'Position check triggered' });
  });

  return wApp;
}

export function userRoutes() {
  const uApp = new Hono();

  uApp.get('/:userId/settings', async (c) => {
    const userId = c.req.param('userId');
    const settings = await getUserSettings(userId);
    if (!settings) {
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(settings);
  });

  uApp.post('/:userId/settings', async (c) => {
    const userId = c.req.param('userId');
    const body = await c.req.json();

    let settings = await getUserSettings(userId);
    if (!settings) {
      settings = await createDefaultSettings(userId, body.telegram);
    }

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

  uApp.get('/:userId/positions', async (c) => {
    const userId = c.req.param('userId');
    const positions = await getTrackedPositions(userId);
    return c.json({ positions });
  });

  uApp.post('/:userId/positions/track', async (c) => {
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

  uApp.delete('/:userId/positions/:positionAddress', async (c) => {
    const userId = c.req.param('userId');
    const positionAddress = c.req.param('positionAddress');
    await untrackPosition(userId, positionAddress);
    return c.json({ success: true, message: 'Position untracked' });
  });

  uApp.get('/:userId/rules', async (c) => {
    const userId = c.req.param('userId');
    const rules = await getUserRules(userId);
    return c.json({ rules });
  });

  uApp.post('/:userId/rules', async (c) => {
    const userId = c.req.param('userId');
    const body = await c.req.json();

    if (body.command) {
      const rule = parseNaturalRule(userId, body.command);
      if (rule) {
        await addUserRule(rule);
        return c.json({ success: true, message: 'Rule created from command', rule });
      } else {
        return c.json({ error: 'Could not parse command into rule', command: body.command }, 400);
      }
    }

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

  uApp.delete('/:userId/rules/:ruleId', async (c) => {
    const userId = c.req.param('userId');
    const ruleId = c.req.param('ruleId');
    await removeUserRule(userId, ruleId);
    return c.json({ success: true, message: 'Rule removed' });
  });

  return uApp;
}

export function alertRoutes() {
  const aApp = new Hono();

  aApp.get('/stats', async (c) => {
    const alertStats = await getAlertStats();
    return c.json(alertStats);
  });

  aApp.get('/failed', async (c) => {
    const failed = await getFailedAlerts();
    return c.json({ failed });
  });

  return aApp;
}

export function riskRoutes() {
  const rApp = new Hono();

  rApp.get('/volatility/:symbol', async (c) => {
    const symbol = c.req.param('symbol').toUpperCase();
    const volatility = await getTokenVolatility(symbol);
    if (!volatility) {
      return c.json({ error: 'Token not found or volatility unavailable' }, 404);
    }
    return c.json({ success: true, volatility });
  });

  return rApp;
}
