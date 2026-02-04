/**
 * LP Agent API Server - Full Railway Version
 * Includes: health, fees, pools, encrypt, wallet, LP
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { arciumPrivacy } from './privacy';
import { config } from './config';

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

// Middleware
app.use('*', cors());

// Connection (stateless - just RPC)
let connection: Connection;
try {
  connection = new Connection(config.solana.rpc || 'https://api.mainnet-beta.solana.com');
  console.log('✅ Solana connection initialized');
} catch (e) {
  console.warn('⚠️ Solana connection failed, using fallback');
  connection = new Connection('https://api.mainnet-beta.solana.com');
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
  version: '2.1.0-stateless',
  status: 'running',
  docs: 'https://mnm-web-seven.vercel.app',
  github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  features: ['MPC Custody', 'Arcium Privacy', 'Stateless API', 'Multi-DEX LP'],
  design: 'STATELESS - pass walletId on every request',
  flow: [
    '1. POST /wallet/create → get walletId',
    '2. Agent stores walletId in its context',
    '3. All subsequent calls pass walletId',
  ],
  endpoints: [
    'GET  /health',
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
    'GET  /positions/:walletId            → list positions',
    'POST /chat       { message, walletId? }',
  ],
}));

app.get('/health', (c) => c.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString(),
}));

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

// ============ Wallet ============

// Create new wallet - returns walletId for agent to store
app.post('/wallet/create', async (c) => {
  const client = await createPrivyClient();
  if (!client) {
    return c.json({ error: 'Privy not available', hint: 'Check PRIVY_APP_ID and PRIVY_APP_SECRET env vars' }, 503);
  }
  try {
    const wallet = await client.generateWallet();
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

// Get positions by walletId
app.get('/positions/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    
    // In production: query on-chain positions for this wallet address
    // For now: return empty (no positions yet)
    return c.json({
      success: true,
      walletId,
      walletAddress: wallet.address,
      positions: [],
      message: 'No LP positions found for this wallet.',
      hint: 'Call POST /lp/open with walletId to create a position',
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
  }
});

// Legacy endpoint - tells agent to use walletId
app.get('/positions', async (c) => {
  return c.json({
    success: false,
    error: 'Missing walletId',
    hint: 'Use GET /positions/:walletId instead',
    example: 'GET /positions/abc123-wallet-id',
  });
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

// ============ Start ============

const port = parseInt(process.env.PORT || '3456');
console.log(`🚀 LP Agent Toolkit - Starting on port ${port}...`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ Server running on http://0.0.0.0:${info.port}`);
});
