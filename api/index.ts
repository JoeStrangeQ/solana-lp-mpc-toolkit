/**
 * Vercel Serverless Entry Point
 * 
 * Exports the Hono app for Vercel Edge/Node runtime
 */

import { handle } from 'hono/vercel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Connection } from '@solana/web3.js';

import { config } from '../src/config';
import { GatewayClient } from '../src/gateway';
import { MockMPCClient } from '../src/mpc/mockClient';
import { PrivyWalletClient } from '../src/mpc/privyClient';
import { arciumPrivacy } from '../src/privacy';
import { parseIntent, describeIntent } from '../src/agent/intent';
import { createFeeBreakdown, FEE_CONFIG } from '../src/fees';
import { jupiterClient, TOKENS } from '../src/swap';
import { lpPipeline, METEORA_POOLS } from '../src/lp';
import type { AgentResponse, LPIntent } from '../src/agent/types';

const app = new Hono();

// Middleware
app.use('*', cors());

// Lazy-init connection
let connection: Connection | null = null;
const getConnection = () => {
  if (!connection) {
    connection = new Connection(config.solana.rpc, 'confirmed');
  }
  return connection;
};

// ============ Health & Status ============

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '2.0.0',
  status: 'running',
  runtime: 'vercel',
  features: ['Jupiter Swaps', 'Meteora DLMM', 'Arcium Privacy'],
  fees: {
    protocol: `${FEE_CONFIG.FEE_BPS / 100}%`,
    treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
  },
}));

app.get('/health', (c) => c.json({
  status: 'ok',
  runtime: 'vercel-serverless',
  timestamp: new Date().toISOString(),
}));

// ============ Fee Info ============

app.get('/fees', (c) => c.json({
  bps: FEE_CONFIG.FEE_BPS,
  percentage: `${FEE_CONFIG.FEE_BPS / 100}%`,
  treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
  minFeeLamports: FEE_CONFIG.MIN_FEE_LAMPORTS,
}));

app.get('/fees/calculate', (c) => {
  const amount = parseFloat(c.req.query('amount') || '0');
  if (!amount || amount <= 0) {
    return c.json({ error: 'Invalid amount' }, 400);
  }
  const breakdown = createFeeBreakdown(amount, 'SOL');
  return c.json(breakdown);
});

// ============ Jupiter Swaps ============

app.get('/swap/tokens', (c) => c.json({
  tokens: Object.entries(TOKENS).map(([symbol, mint]) => ({ symbol, mint })),
}));

app.get('/swap/quote', async (c) => {
  const inputToken = c.req.query('inputToken');
  const outputToken = c.req.query('outputToken');
  const amount = c.req.query('amount');

  if (!inputToken || !outputToken || !amount) {
    return c.json({ error: 'Missing inputToken, outputToken, or amount' }, 400);
  }

  try {
    const inputMint = jupiterClient.resolveTokenMint(inputToken);
    const outputMint = jupiterClient.resolveTokenMint(outputToken);
    const quote = await jupiterClient.getQuote(inputMint, outputMint, parseInt(amount));
    return c.json({ success: true, quote });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============ LP Pools ============

app.get('/lp/pools', (c) => c.json({
  pools: Object.entries(METEORA_POOLS).map(([pair, address]) => ({ pair, address })),
}));

// ============ Chat Interface ============

app.post('/chat', async (c) => {
  const body = await c.req.json();
  const message = body.message || body.text;

  if (!message) {
    return c.json<AgentResponse>({
      success: false,
      error: 'No message provided',
    }, 400);
  }

  const intent = parseIntent(message);
  const description = describeIntent(intent);

  // For now, just return the parsed intent (no execution in serverless)
  return c.json<AgentResponse>({
    success: true,
    message: description,
    data: {
      intent,
      note: 'Use /swap or /lp endpoints with wallet for execution',
    },
  });
});

// Export for Vercel
export default handle(app);
