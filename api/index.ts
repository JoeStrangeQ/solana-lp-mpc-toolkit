/**
 * Vercel serverless entry point
 * Routes to the Hono API server
 */

import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { cors } from 'hono/cors';
import { createFeeBreakdown, FEE_CONFIG } from '../src/fees';

// Create a minimal Hono app for Vercel (no runtime dependencies)
const app = new Hono().basePath('/');

// Middleware
app.use('*', cors());

// ============ Health & Status ============

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '2.0.0',
  status: 'running',
  docs: 'https://mnm-web-seven.vercel.app',
  github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  features: ['MPC Custody', 'Arcium Privacy', 'Multi-DEX LP'],
  endpoints: [
    'GET /health - Health check',
    'GET /fees - Fee configuration',
    'GET /fees/calculate?amount=1000 - Calculate fee',
    'GET /pools/scan?tokenA=SOL&tokenB=USDC - Scan pools (coming soon)',
  ],
}));

app.get('/health', (c) => c.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

// ============ Fee Info ============

app.get('/fees', (c) => {
  return c.json({
    protocolFee: {
      bps: FEE_CONFIG.FEE_BPS,
      percentage: `${FEE_CONFIG.FEE_BPS / 100}%`,
      description: 'Fee deducted from every LP transaction',
    },
    treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
    minFee: {
      lamports: FEE_CONFIG.MIN_FEE_LAMPORTS,
      description: 'Minimum fee threshold to avoid dust',
    },
    exemptThreshold: {
      usd: FEE_CONFIG.EXEMPT_THRESHOLD_USD,
      description: 'Transactions below this USD value are fee-exempt',
    },
    calculate: '/fees/calculate?amount=1000 - Calculate fee for specific amount',
  });
});

app.get('/fees/calculate', (c) => {
  const amount = parseFloat(c.req.query('amount') || '0');
  if (amount <= 0) {
    return c.json({ error: 'Provide a positive amount query parameter' }, 400);
  }
  
  const breakdown = createFeeBreakdown(amount);
  return c.json({
    input: amount,
    fee: breakdown.protocol,
    output: breakdown.total.netAmount,
    message: `${breakdown.protocol.amount} (${breakdown.protocol.bps / 100}%) goes to protocol treasury`,
  });
});

// ============ Pool Scanning (Vercel-safe, static data) ============

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
    baseFee: 0.0002,
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
    baseFee: 0.0001,
  },
];

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
    pools: pools,
    note: 'Sample data for demo. Full scanning requires Gateway connection.',
  });
});

// Export for Vercel
export default handle(app);
