/**
 * Vercel serverless entry point
 * Native Vercel handler (no Hono for reliability)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Fee config
const FEE_CONFIG = {
  FEE_BPS: 10, // 0.1%
  TREASURY: 'fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt',
  MIN_FEE_LAMPORTS: 10000,
  EXEMPT_THRESHOLD_USD: 1,
};

// Sample pool data
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
  {
    address: 'FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q',
    name: 'SOL-USDC',
    dex: 'meteora',
    tokens: ['SOL', 'USDC'],
    tvl: 1500000,
    apy: 35.0,
    volume24h: 650000,
    binStep: 1,
    baseFee: 0.0001,
  },
];

function createFeeBreakdown(grossAmount: number) {
  const feeAmount = (grossAmount * FEE_CONFIG.FEE_BPS) / 10000;
  const netAmount = grossAmount - feeAmount;
  return { feeAmount, netAmount };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url || '/';
  const url = new URL(path, 'http://localhost');
  const pathname = url.pathname;

  // Route: /health
  if (pathname === '/health') {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  // Route: /fees
  if (pathname === '/fees') {
    return res.json({
      protocolFee: {
        bps: FEE_CONFIG.FEE_BPS,
        percentage: `${FEE_CONFIG.FEE_BPS / 100}%`,
        description: 'Fee deducted from every LP transaction',
      },
      treasury: FEE_CONFIG.TREASURY,
      minFee: {
        lamports: FEE_CONFIG.MIN_FEE_LAMPORTS,
        description: 'Minimum fee threshold to avoid dust',
      },
      exemptThreshold: {
        usd: FEE_CONFIG.EXEMPT_THRESHOLD_USD,
        description: 'Transactions below this USD value are fee-exempt',
      },
      calculate: '/fees/calculate?amount=1000',
    });
  }

  // Route: /fees/calculate
  if (pathname === '/fees/calculate') {
    const amount = parseFloat(url.searchParams.get('amount') || '0');
    if (amount <= 0) {
      return res.status(400).json({ error: 'Provide a positive amount query parameter' });
    }
    const { feeAmount, netAmount } = createFeeBreakdown(amount);
    return res.json({
      input: amount,
      fee: { bps: FEE_CONFIG.FEE_BPS, amount: feeAmount },
      output: netAmount,
      message: `${feeAmount.toFixed(4)} (${FEE_CONFIG.FEE_BPS / 100}%) goes to protocol treasury`,
    });
  }

  // Route: /pools/scan
  if (pathname === '/pools/scan') {
    const tokenA = url.searchParams.get('tokenA') || 'SOL';
    const tokenB = url.searchParams.get('tokenB') || 'USDC';
    const pools = SAMPLE_POOLS.filter(p => 
      p.tokens.includes(tokenA.toUpperCase()) && 
      p.tokens.includes(tokenB.toUpperCase())
    );
    return res.json({
      success: true,
      pair: `${tokenA}-${tokenB}`,
      count: pools.length,
      pools: pools,
      note: 'Sample data for demo. Full scanning requires local server with Gateway connection.',
    });
  }

  // Default: root
  return res.json({
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
      'GET /pools/scan?tokenA=SOL&tokenB=USDC - Scan pools',
    ],
  });
}
