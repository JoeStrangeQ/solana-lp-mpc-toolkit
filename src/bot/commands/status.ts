/**
 * /status command handler - System health overview
 */
import type { BotContext } from '../types.js';
import { getCircuitBreakerStatus } from '../../services/ultra-swap.js';

export async function statusCommand(ctx: BotContext) {
  const startTime = Date.now();
  
  // Check various system components
  const checks: Array<{ name: string; status: '✅' | '⚠️' | '❌'; detail?: string }> = [];

  // 1. Check RPC connection
  try {
    const { getConnection } = await import('../../services/connection-pool.js');
    const conn = getConnection();
    const slot = await conn.getSlot();
    checks.push({ name: 'Solana RPC', status: '✅', detail: `slot ${slot}` });
  } catch (e) {
    checks.push({ name: 'Solana RPC', status: '❌', detail: 'unreachable' });
  }

  // 2. Check Jupiter circuit breaker
  try {
    const cbStatus = getCircuitBreakerStatus();
    if (cbStatus.state === 'closed') {
      checks.push({ name: 'Jupiter API', status: '✅' });
    } else if (cbStatus.state === 'half-open') {
      checks.push({ name: 'Jupiter API', status: '⚠️', detail: 'recovering' });
    } else {
      checks.push({ name: 'Jupiter API', status: '❌', detail: 'circuit open' });
    }
  } catch (e) {
    checks.push({ name: 'Jupiter API', status: '⚠️', detail: 'unknown' });
  }

  // 3. Check Redis
  try {
    const { getRedis } = await import('../../services/lp-service.js');
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      checks.push({ name: 'Redis Cache', status: '✅' });
    } else {
      checks.push({ name: 'Redis Cache', status: '⚠️', detail: 'not configured' });
    }
  } catch (e) {
    checks.push({ name: 'Redis Cache', status: '❌', detail: 'unreachable' });
  }

  // 4. Check Privy
  try {
    const { config } = await import('../../config/index.js');
    if (config.privy?.appId) {
      checks.push({ name: 'Privy MPC', status: '✅' });
    } else {
      checks.push({ name: 'Privy MPC', status: '⚠️', detail: 'not configured' });
    }
  } catch (e) {
    checks.push({ name: 'Privy MPC', status: '⚠️' });
  }

  // 5. Check Jito
  try {
    if (process.env.JITO_API_KEY) {
      checks.push({ name: 'Jito Bundles', status: '✅' });
    } else {
      checks.push({ name: 'Jito Bundles', status: '⚠️', detail: 'no API key' });
    }
  } catch (e) {
    checks.push({ name: 'Jito Bundles', status: '⚠️' });
  }

  const elapsed = Date.now() - startTime;
  const allGood = checks.every(c => c.status === '✅');
  const hasErrors = checks.some(c => c.status === '❌');

  const statusEmoji = allGood ? '🟢' : hasErrors ? '🔴' : '🟡';
  const statusText = allGood ? 'All Systems Operational' : hasErrors ? 'Degraded' : 'Partial';

  const lines = [
    `${statusEmoji} *System Status: ${statusText}*`,
    ``,
    ...checks.map(c => `${c.status} ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    ``,
    `_Checked in ${elapsed}ms_`,
  ];

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}
