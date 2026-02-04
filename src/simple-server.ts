/**
 * LP Agent API Server - Minimal Railway Version
 * Includes: health, fees, pools, encrypt
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { arciumPrivacy } from './privacy';

const app = new Hono();

// Middleware
app.use('*', cors());

// Fee config
const FEE_CONFIG = {
  FEE_BPS: 10, // 0.1%
  TREASURY: 'BNQnCszvPwYfjBMUmFgmCooMSRrdkC7LncMQBExDakLp',
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
  version: '2.0.0',
  status: 'running',
  docs: 'https://mnm-web-seven.vercel.app',
  github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  features: ['MPC Custody', 'Arcium Privacy', 'Multi-DEX LP'],
  endpoints: [
    'GET /health',
    'GET /fees',
    'GET /fees/calculate?amount=1000',
    'GET /pools/scan?tokenA=SOL&tokenB=USDC',
    'POST /encrypt',
    'GET /encrypt/info',
  ],
}));

app.get('/health', (c) => c.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString(),
}));

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
    return c.json({ error: 'Encryption failed' }, 500);
  }
});

app.get('/encrypt/test', async (c) => {
  await arciumPrivacy.initialize();
  const passed = await arciumPrivacy.selfTest();
  return c.json({ success: passed, algorithm: 'x25519-aes256gcm' });
});

// ============ Start ============

const port = parseInt(process.env.PORT || '3456');
console.log(`🚀 LP Agent Toolkit - Starting on port ${port}...`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ Server running on http://0.0.0.0:${info.port}`);
});
