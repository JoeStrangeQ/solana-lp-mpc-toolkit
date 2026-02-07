/**
 * Chat Route - Natural language chat interface
 */
import { Hono } from 'hono';
import { SAMPLE_POOLS, FEE_CONFIG } from '../services/pool-service.js';

const app = new Hono();

app.post('/', async (c) => {
  try {
    const { message, walletId } = await c.req.json();
    if (!message) {
      return c.json({ error: 'Missing message' }, 400);
    }

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

export default app;
