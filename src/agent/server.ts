/**
 * LP Agent API Server
 *
 * REST API for AI agents to manage LP positions across Solana DEXs
 * with Arcium privacy and self-custody (agents sign their own transactions)
 * 
 * ARCHITECTURE:
 * - Stateless API - no private keys stored
 * - Agents provide their wallet address
 * - API returns unsigned transactions
 * - Agents sign with their own keys
 * - Arcium encrypts strategy params for privacy
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection } from '@solana/web3.js';

import { config } from '../config';
import { GatewayClient } from '../gateway';
import { MPCClient } from '../mpc';
import { MockMPCClient } from '../mpc/mockClient';
import { PrivyWalletClient } from '../mpc/privyClient';
import { LocalKeypairClient } from '../mpc/localKeypair';
import { arciumPrivacy } from '../privacy';
import { parseIntent, describeIntent } from './intent';
import { createFeeBreakdown, FEE_CONFIG } from '../fees';
import type { AgentResponse, LPIntent, PoolOpportunity } from './types';
import { unsignedApi } from './unsigned';

// Static imports for LP and Swap modules
import { lpPipeline as lpPipelineImport, METEORA_POOLS as meteoraPoolsImport } from '../lp';
import { jupiterClient as jupiterClientImport, TOKENS as tokensImport } from '../swap';

// Module references (populated from imports or lazy-load fallback)
let jupiterClient: any = jupiterClientImport || null;
let TOKENS: Record<string, string> = tokensImport || {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};
let lpPipeline: any = lpPipelineImport || null;
let METEORA_POOLS: Record<string, string> = meteoraPoolsImport || {
  'SOL-USDC': 'BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE',
};

async function loadSwapModule() {
  if (!jupiterClient) {
    try {
      const mod = await import('../swap/index.js');
      jupiterClient = mod.jupiterClient;
      TOKENS = mod.TOKENS || TOKENS;
    } catch (e) {
      console.warn('⚠️ Failed to load swap module:', (e as Error).message);
    }
  }
  return jupiterClient;
}

async function loadLpModule() {
  if (!lpPipeline) {
    try {
      console.log('📦 Loading LP module...');
      const mod = await import('../lp/index.js');
      lpPipeline = mod.lpPipeline;
      METEORA_POOLS = mod.METEORA_POOLS || METEORA_POOLS;
      console.log('✅ LP module loaded successfully');
    } catch (e) {
      console.error('❌ Failed to load LP module:', (e as Error).message);
      console.error('Stack:', (e as Error).stack);
    }
  }
  return lpPipeline;
}

const app = new Hono();

// Middleware
app.use('*', cors());

// Mount stateless unsigned transaction API (primary interface for agents)
app.route('/v2', unsignedApi);

// State - supports multiple wallet providers (legacy, for testing)
let mpcClient: MPCClient | MockMPCClient | null = null;
let privyClient: PrivyWalletClient | null = null;
let localKeypairClient: LocalKeypairClient | null = null;
let gatewayClient: GatewayClient | null = null;
let connection: Connection;

// ============ Health & Status ============

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '3.0.0-stateless',
  status: 'running',
  architecture: {
    model: 'Stateless - agents sign their own transactions',
    privacy: 'Arcium MXE encrypts strategy parameters',
    custody: 'Self-custody - API never holds private keys',
  },
  endpoints: {
    v2: {
      '/v2/lp/build': 'POST - Build unsigned LP transaction',
      '/v2/swap/build': 'POST - Build unsigned swap transaction',
      '/v2/broadcast': 'POST - Broadcast signed transaction',
      '/v2/encrypt-strategy': 'POST - Encrypt params with Arcium',
    },
    legacy: {
      '/pools/scan': 'GET - Scan for LP opportunities',
      '/encrypt': 'POST - Arcium encryption',
      '/health': 'GET - Service health',
    },
  },
  fees: {
    protocol: `${FEE_CONFIG.FEE_BPS / 100}%`,
    description: 'Protocol fee on LP transactions',
    treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
  },
}));

// ============ Fee Info ============

app.get('/fees', (c) => {
  return c.json({
    protocolFee: {
      bps: FEE_CONFIG.FEE_BPS,
      percentage: `${FEE_CONFIG.FEE_BPS / 100}%`,
      description: '1% fee deducted from every LP transaction',
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

app.get('/health', async (c) => {
  const gatewayOk = gatewayClient ? await gatewayClient.healthCheck() : false;
  const walletOk = privyClient?.isWalletLoaded() || mpcClient?.isWalletLoaded() || false;
  const arciumOk = arciumPrivacy.isInitialized();

  const walletProvider = privyClient?.isWalletLoaded() ? 'privy' : 
                        mpcClient?.isWalletLoaded() ? (config.portal.useMock ? 'mock' : 'portal') : 
                        'none';

  return c.json({
    status: gatewayOk && walletOk ? 'healthy' : 'degraded',
    components: {
      gateway: gatewayOk ? 'connected' : 'disconnected',
      wallet: walletOk ? `loaded (${walletProvider})` : 'no_wallet',
      arcium: arciumOk ? 'initialized' : 'not_initialized',
    },
    walletProviders: {
      privy: config.privy.enabled ? 'configured' : 'not_configured',
      portal: config.portal.apiKey ? 'configured' : 'not_configured',
      mock: config.portal.useMock ? 'enabled' : 'disabled',
    },
    timestamp: new Date().toISOString(),
  });
});

// ============ Arcium Encryption ============

app.get('/encrypt/info', async (c) => {
  await arciumPrivacy.initialize();
  const info = arciumPrivacy.getMxeInfo();
  
  return c.json({
    status: 'ready',
    algorithm: 'x25519-aes256gcm',
    mxe: {
      cluster: info.cluster,
      network: 'devnet',
      publicKey: info.publicKey,
    },
    description: 'Strategy parameters are encrypted before execution to prevent front-running',
  });
});

app.post('/encrypt', async (c) => {
  try {
    const body = await c.req.json();
    const { strategy } = body;
    
    if (!strategy) {
      return c.json({ error: 'Missing strategy object' }, 400);
    }
    
    // Validate strategy has required fields
    if (!strategy.pair || !strategy.amount) {
      return c.json({ error: 'Strategy must include pair and amount' }, 400);
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
        timestamp: encrypted.timestamp,
      },
      message: 'Strategy encrypted with Arcium. Only MXE can decrypt.',
    });
  } catch (error) {
    console.error('[/encrypt] Error:', error);
    return c.json({ 
      error: 'Encryption failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

app.get('/encrypt/test', async (c) => {
  try {
    await arciumPrivacy.initialize();
    const passed = await arciumPrivacy.selfTest();
    
    return c.json({
      success: passed,
      message: passed ? 'Arcium encryption self-test passed' : 'Self-test failed',
      algorithm: 'x25519-aes256gcm',
      mxeCluster: 456,
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// ============ Wallet Management ============

app.post('/wallet/create', async (c) => {
  try {
    console.log('[/wallet/create] Received request');
    
    // Priority: Privy > Portal > Mock
    if (config.privy.enabled) {
      // Use Privy embedded wallet
      console.log('[/wallet/create] Using Privy embedded wallet');
      privyClient = new PrivyWalletClient({
        appId: config.privy.appId,
        appSecret: config.privy.appSecret,
      });
      
      const wallet = await privyClient.generateWallet();
      console.log('[/wallet/create] Privy wallet generated:', wallet.addresses.solana);
      
      gatewayClient = new GatewayClient(wallet.addresses.solana);
      
      return c.json<AgentResponse>({
        success: true,
        message: 'Privy embedded wallet created. Fund this address to start LPing.',
        data: {
          address: wallet.addresses.solana,
          walletId: wallet.id,
          provider: 'privy',
        },
      });
    } else if (config.portal.useMock) {
      // Use mock wallet for dev
      mpcClient = new MockMPCClient();
      console.log('[/wallet/create] Using Mock MPC client');
    } else if (config.portal.apiKey) {
      // Use Portal MPC
      mpcClient = new MPCClient();
      console.log('[/wallet/create] Using Portal MPC client');
    } else {
      throw new Error('No wallet provider configured. Set PRIVY_APP_ID/PRIVY_APP_SECRET or PORTAL_API_KEY or USE_MOCK_MPC=true');
    }
    
    const wallet = await mpcClient.generateWallet();
    console.log('[/wallet/create] Wallet generated:', wallet.addresses.solana);
    
    gatewayClient = new GatewayClient(wallet.addresses.solana);
    console.log('[/wallet/create] Gateway client initialized');

    return c.json<AgentResponse>({
      success: true,
      message: 'MPC wallet created. Fund this address to start LPing.',
      data: {
        address: wallet.addresses.solana,
        walletId: wallet.id,
        provider: config.portal.useMock ? 'mock' : 'portal',
      },
    });
  } catch (error) {
    console.error('[/wallet/create] Error:', error);
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to create wallet',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Note: /wallet/list removed - use Privy dashboard to find walletIds

app.post('/wallet/load', async (c) => {
  try {
    const { address, share, id, walletId, provider } = await c.req.json();

    // Support Privy wallet loading by walletId
    if (config.privy.enabled && walletId) {
      console.log('[/wallet/load] Loading Privy wallet:', walletId);
      privyClient = new PrivyWalletClient({
        appId: config.privy.appId,
        appSecret: config.privy.appSecret,
      });
      
      const wallet = await privyClient.loadWallet(walletId);
      gatewayClient = new GatewayClient(wallet.address);
      
      return c.json<AgentResponse>({
        success: true,
        message: 'Privy wallet loaded',
        data: { address: wallet.address, walletId: wallet.id, provider: 'privy' },
      });
    }

    // Legacy Portal/Mock wallet loading
    if (!address || !share) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing address or share (or walletId for Privy)',
      }, 400);
    }

    if (config.portal.useMock) {
      mpcClient = new MockMPCClient();
    } else {
      if (!config.portal.apiKey) {
        throw new Error('Portal API key is not configured.');
      }
      mpcClient = new MPCClient();
    }

    mpcClient.loadWallet({
      id: id || 'loaded',
      addresses: { solana: address },
      share,
      createdAt: new Date().toISOString(),
    });

    gatewayClient = new GatewayClient(address);

    return c.json<AgentResponse>({
      success: true,
      message: 'Wallet loaded successfully',
      data: { address },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to load wallet',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Load local keypair for testing (supports actual transaction signing)
// Uses LOCAL_WALLET_KEY env var if set, otherwise generates new
app.post('/wallet/local', async (c) => {
  try {
    const { privateKey, forceNew } = await c.req.json().catch(() => ({}));
    
    // If we already have a local keypair and not forcing new, return it
    if (localKeypairClient && !forceNew && !privateKey) {
      return c.json<AgentResponse>({
        success: true,
        message: 'Existing local keypair returned. This wallet CAN sign arbitrary transactions.',
        data: {
          address: localKeypairClient.getAddress(),
          provider: 'local-keypair',
          reused: true,
        },
      });
    }
    
    // Priority: provided key > env var > generate new
    const keyToUse = privateKey || process.env.LOCAL_WALLET_KEY || undefined;
    localKeypairClient = new LocalKeypairClient(keyToUse);
    const address = localKeypairClient.getAddress();
    
    const source = privateKey ? 'provided' : (process.env.LOCAL_WALLET_KEY ? 'env' : 'generated');
    
    return c.json<AgentResponse>({
      success: true,
      message: source === 'env' 
        ? 'Local keypair loaded from LOCAL_WALLET_KEY env var.'
        : source === 'provided'
        ? 'Local keypair loaded from provided key.'
        : 'New local keypair generated. Set LOCAL_WALLET_KEY env var to persist.',
      data: {
        address,
        provider: 'local-keypair',
        source,
        persistent: source === 'env',
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to create local keypair',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.get('/wallet/address', (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded',
    }, 400);
  }

  return c.json<AgentResponse>({
    success: true,
    message: 'Wallet address',
    data: { address: walletClient.getAddress() },
  });
});

// Transfer SOL from loaded wallet using Privy signAndSendTransaction
app.post('/wallet/transfer', async (c) => {
  // Must use Privy client for transfers
  if (!privyClient?.isWalletLoaded()) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No Privy wallet loaded. Load a wallet first.',
    }, 400);
  }

  try {
    const { to, amount } = await c.req.json();
    
    if (!to || !amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing "to" address or "amount" (in SOL)',
      }, 400);
    }

    const { LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

    // Use Privy transfer (builds tx and signs/sends via Privy)
    const txid = await privyClient.transfer(to, lamports, connection);

    return c.json<AgentResponse>({
      success: true,
      message: `Transferred ${amount} SOL to ${to}`,
      data: { txid, from: privyClient.getAddress(), to, amount },
      transaction: { unsigned: '', txid },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Transfer failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============ Natural Language Interface ============

app.post('/chat', async (c) => {
  try {
    const { message } = await c.req.json();

    if (!message) {
      return c.json<AgentResponse>({
        success: false,
        message: 'No message provided',
      }, 400);
    }

    const intent = parseIntent(message);
    const description = describeIntent(intent);

    // Route to appropriate handler
    let result: AgentResponse;

    switch (intent.action) {
      case 'lp':
        result = await handleLp(intent);
        break;
      case 'swap':
        result = await handleSwap(intent);
        break;
      case 'scan':
        result = await handleScan(intent);
        break;
      case 'open':
        result = await handleOpenPosition(intent);
        break;
      case 'close':
        result = await handleClosePosition(intent);
        break;
      case 'collect':
        result = await handleCollectFees(intent);
        break;
      case 'positions':
        result = await handleGetPositions();
        break;
      default:
        result = {
          success: true,
          message: `Understood: ${description}`,
          data: { intent },
        };
    }

    return c.json(result);
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to process request',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============ Direct API Endpoints ============

app.get('/pools/scan', async (c) => {
  const tokenA = c.req.query('tokenA');
  const tokenB = c.req.query('tokenB');
  const dex = c.req.query('dex') as 'meteora' | 'orca' | 'raydium' | undefined;

  const result = await handleScan({ action: 'scan', pair: tokenA && tokenB ? `${tokenA}-${tokenB}` : undefined, dex });
  return c.json(result);
});

app.get('/positions', async (c) => {
  const result = await handleGetPositions();
  return c.json(result);
});

app.post('/position/open', async (c) => {
  const body = await c.req.json();
  const result = await handleOpenPosition({
    action: 'open',
    dex: body.dex,
    pair: body.pair,
    amount: body.amount,
    strategy: body.strategy,
  });
  return c.json(result);
});

app.post('/position/close', async (c) => {
  const { positionId, dex } = await c.req.json();
  const result = await handleClosePosition({ action: 'close', positionId, dex });
  return c.json(result);
});

app.post('/position/collect-fees', async (c) => {
  const { positionId, dex } = await c.req.json();
  const result = await handleCollectFees({ action: 'collect', positionId, dex });
  return c.json(result);
});

// ============ Swap Endpoint ============

app.post('/swap', async (c) => {
  const body = await c.req.json();
  const result = await handleSwap({
    action: 'swap',
    inputToken: body.inputMint || body.inputToken,
    outputToken: body.outputMint || body.outputToken,
    amount: body.amount,
  });
  return c.json(result);
});

app.get('/swap/quote', async (c) => {
  const inputToken = c.req.query('inputMint') || c.req.query('inputToken');
  const outputToken = c.req.query('outputMint') || c.req.query('outputToken');
  const amount = c.req.query('amount');

  if (!inputToken || !outputToken || !amount) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Missing inputMint/inputToken, outputMint/outputToken, or amount',
    }, 400);
  }

  try {
    const jup = await loadSwapModule();
    if (!jup) {
      return c.json<AgentResponse>({ success: false, message: 'Swap module not available' }, 503);
    }
    const inputMint = jup.resolveTokenMint(inputToken);
    const outputMint = jup.resolveTokenMint(outputToken);
    const quote = await jup.getQuote(inputMint, outputMint, amount);

    return c.json<AgentResponse>({
      success: true,
      message: `Quote: ${quote.inAmount} ${inputToken} -> ${quote.outAmount} ${outputToken}`,
      data: {
        quote,
        inputMint,
        outputMint,
        priceImpact: quote.priceImpactPct,
        route: quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> '),
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to get quote',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.get('/swap/tokens', (c) => {
  return c.json({
    tokens: TOKENS,
    description: 'Well-known token mints. Use symbol (SOL, USDC) or full mint address.',
  });
});

// ============ LP Pipeline Endpoints ============

app.get('/lp/pools', (c) => {
  return c.json({
    pools: METEORA_POOLS,
    description: 'Supported Meteora DLMM pools for LP pipeline',
  });
});

app.post('/lp/prepare', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const lp = await loadLpModule();
    if (!lp) {
      return c.json<AgentResponse>({ success: false, message: 'LP module not available' }, 503);
    }

    const { tokenA, tokenB, amount } = await c.req.json();

    if (!tokenA || !tokenB || !amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing tokenA, tokenB, or amount. Example: { "tokenA": "SOL", "tokenB": "USDC", "amount": 500 }',
      }, 400);
    }

    const walletAddress = walletClient.getAddress();
    const result = await lp.prepareLiquidity(walletAddress, tokenA, tokenB, amount);

    return c.json<AgentResponse>({
      success: result.ready,
      message: result.message,
      data: result,
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to prepare liquidity',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.post('/lp/execute', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const lp = await loadLpModule();
    if (!lp) {
      return c.json<AgentResponse>({ success: false, message: 'LP module not available' }, 503);
    }

    const { tokenA, tokenB, amount } = await c.req.json();

    if (!tokenA || !tokenB || !amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing tokenA, tokenB, or amount. Example: { "tokenA": "SOL", "tokenB": "USDC", "amount": 500 }',
      }, 400);
    }

    const walletAddress = walletClient.getAddress();
    // Use signTransaction ONLY (not signAndSendTransaction) - we'll broadcast ourselves
    // This allows us to add the position keypair signature before broadcasting
    const signTransaction = async (tx: string) => walletClient.signTransaction(tx);

    const result = await lp.execute(walletAddress, tokenA, tokenB, amount, signTransaction);

    return c.json<AgentResponse>({
      success: result.success,
      message: result.message,
      data: {
        swapTxid: result.swapTxid,
        lpTxid: result.lpTxid,
        positionAddress: result.positionAddress,
        binRange: result.binRange,
      },
      transaction: result.lpTxid ? { unsigned: '', txid: result.lpTxid } : undefined,
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to execute LP',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============ Handlers ============

async function handleLp(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return { success: false, message: 'No wallet loaded. Create or load a wallet first.' };
  }

  if (!intent.pair) {
    return { 
      success: false, 
      message: 'Missing token pair. Example: "LP $500 into SOL-USDC"',
    };
  }

  const [tokenA, tokenB] = intent.pair.split('-');
  if (!tokenA || !tokenB) {
    return { 
      success: false, 
      message: 'Invalid pair format. Use TOKEN-TOKEN format like SOL-USDC',
    };
  }

  const walletAddress = walletClient.getAddress();

  // Load LP module
  const lp = await loadLpModule();
  if (!lp) {
    return { success: false, message: 'LP module not available' };
  }

  // If no amount specified, just prepare and return what's needed
  if (!intent.amount) {
    try {
      const prep = await lp.prepareLiquidity(walletAddress, tokenA, tokenB, 0);
      return {
        success: true,
        message: `To LP into ${intent.pair}, specify an amount. Example: "LP $500 into ${intent.pair}"`,
        data: {
          poolInfo: prep.poolInfo,
          currentBalances: prep.currentBalances,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get pool info',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // First, prepare to see what's needed
  try {
    const prep = await lp.prepareLiquidity(walletAddress, tokenA, tokenB, intent.amount);

    if (!prep.ready) {
      return {
        success: false,
        message: prep.message,
        data: {
          currentBalances: prep.currentBalances,
          targetAmounts: prep.targetAmounts,
          poolInfo: prep.poolInfo,
        },
      };
    }

    // Execute the full pipeline (swap if needed + LP)
    const signTransaction = async (tx: string) => walletClient.signTransaction(tx);
    const result = await lp.execute(walletAddress, tokenA, tokenB, intent.amount, signTransaction);

    // Calculate 1% protocol fee
    const feeBreakdown = createFeeBreakdown(intent.amount);

    return {
      success: result.success,
      message: result.message,
      data: {
        swapTxid: result.swapTxid,
        lpTxid: result.lpTxid,
        positionAddress: result.positionAddress,
        binRange: result.binRange,
        fees: {
          protocolFee: feeBreakdown.protocol.amount,
          protocolFeeBps: feeBreakdown.protocol.bps,
          treasury: feeBreakdown.protocol.recipient,
          netAmount: feeBreakdown.total.netAmount,
          grossAmount: feeBreakdown.total.grossAmount,
        },
      },
      transaction: result.lpTxid ? { unsigned: '', txid: result.lpTxid } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: 'LP operation failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleScan(intent: LPIntent): Promise<AgentResponse> {
  if (!gatewayClient) {
    return { success: false, message: 'No wallet loaded' };
  }

  try {
    const dexes = intent.dex ? [intent.dex] : ['meteora', 'orca', 'raydium'] as const;
    const [tokenA, tokenB] = intent.pair?.split('-') || [];

    const allPools: PoolOpportunity[] = [];

    for (const dex of dexes) {
      try {
        const pools = await gatewayClient.fetchPools(dex, tokenA, tokenB);
        for (const pool of pools.slice(0, 5)) {
          allPools.push({
            dex,
            pool: pool.address,
            pair: `${pool.tokenA.symbol}-${pool.tokenB.symbol}`,
            apy: 0, // Would come from external API
            tvl: parseFloat(pool.liquidity) || 0,
            volume24h: 0,
            fee: pool.fee,
          });
        }
      } catch {
        // Continue on individual DEX failures
      }
    }

    // Sort by TVL for now
    allPools.sort((a, b) => b.tvl - a.tvl);

    return {
      success: true,
      message: `Found ${allPools.length} pools`,
      data: { pools: allPools.slice(0, 10) },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to scan pools',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleGetPositions(): Promise<AgentResponse> {
  if (!gatewayClient) {
    return { success: false, message: 'No wallet loaded' };
  }

  try {
    const allPositions = await gatewayClient.getAllPositions();

    const summary = allPositions.flatMap(({ dex, positions }) =>
      positions.map((p) => ({
        id: p.id,
        dex,
        pool: p.pool,
        inRange: p.inRange,
        liquidity: p.liquidity,
        unclaimedFeesA: p.unclaimedFeesA,
        unclaimedFeesB: p.unclaimedFeesB,
      }))
    );

    return {
      success: true,
      message: `Found ${summary.length} positions`,
      data: { positions: summary },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to fetch positions',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleSwap(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return { success: false, message: 'No wallet loaded. Create or load a wallet first.' };
  }

  if (!intent.inputToken || !intent.outputToken || !intent.amount) {
    return { 
      success: false, 
      message: 'Missing inputToken, outputToken, or amount. Example: "swap 1 SOL to USDC"',
    };
  }

  try {
    // Load swap module
    const jup = await loadSwapModule();
    if (!jup) {
      return { success: false, message: 'Swap module not available' };
    }

    // Resolve token symbols to mint addresses
    const inputMint = jup.resolveTokenMint(intent.inputToken);
    const outputMint = jup.resolveTokenMint(intent.outputToken);

    // Convert amount to base units (lamports for SOL = 9 decimals, USDC = 6 decimals)
    // For simplicity, we assume SOL has 9 decimals, stablecoins 6
    // Token decimals - BONK is 5, most others are 6, SOL is 9
    const TOKEN_DECIMALS: Record<string, number> = {
      SOL: 9, USDC: 6, USDT: 6, BONK: 5, WIF: 6, JUP: 6, RAY: 6,
    };
    const inputDecimals = TOKEN_DECIMALS[intent.inputToken.toUpperCase()] ?? 6;
    const amountBaseUnits = Math.floor(intent.amount * Math.pow(10, inputDecimals));

    // Get the user's wallet address
    const userPublicKey = walletClient.getAddress();

    // Get quote
    const quote = await jup.getQuote(inputMint, outputMint, amountBaseUnits);
    
    // Build swap transaction
    const swapResult = await jup.swap(quote, userPublicKey);

    // Sign the transaction
    const signedTx = await walletClient.signTransaction(swapResult.swapTransaction);

    // Broadcast
    const txid = await broadcastTransaction(signedTx);

    // Format output amount
    const outputDecimals = intent.outputToken.toUpperCase() === 'SOL' ? 9 : 6;
    const outputAmount = parseInt(quote.outAmount) / Math.pow(10, outputDecimals);

    return {
      success: true,
      message: `Swapped ${intent.amount} ${intent.inputToken} for ${outputAmount.toFixed(6)} ${intent.outputToken}`,
      data: {
        inputToken: intent.inputToken,
        inputMint,
        inputAmount: intent.amount,
        outputToken: intent.outputToken,
        outputMint,
        outputAmount,
        priceImpact: quote.priceImpactPct,
        route: quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> '),
      },
      transaction: {
        unsigned: swapResult.swapTransaction,
        signed: signedTx,
        txid,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Swap failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Helper to get active wallet client (Local Keypair, Privy, or MPC)
function getWalletClient() {
  if (localKeypairClient) return localKeypairClient;
  if (privyClient?.isWalletLoaded()) return privyClient;
  if (mpcClient?.isWalletLoaded()) return mpcClient;
  return null;
}

async function handleOpenPosition(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!gatewayClient || !walletClient) {
    return { success: false, message: 'Wallet not initialized' };
  }

  if (!intent.dex || !intent.pair || !intent.amount) {
    return { success: false, message: 'Missing dex, pair, or amount' };
  }

  try {
    // Encrypt strategy with Arcium
    await arciumPrivacy.initialize();
    const encryptedStrategy = await arciumPrivacy.encryptStrategy({
      intent: 'open_position',
      dex: intent.dex,
      pool: intent.pair,
      tokenA: intent.pair.split('-')[0],
      tokenB: intent.pair.split('-')[1],
      amountA: intent.amount / 2,
      amountB: intent.amount / 2,
      slippage: 0.5,
    });

    // Get pool info to determine price range
    const pools = await gatewayClient.fetchPools(intent.dex);
    const pool = pools[0]; // In production, match by pair

    if (!pool) {
      return { success: false, message: 'Pool not found' };
    }

    // Calculate price range based on strategy
    const currentPrice = pool.currentPrice;
    let lowerPrice: number, upperPrice: number;

    switch (intent.strategy) {
      case 'concentrated':
        lowerPrice = currentPrice * 0.98;
        upperPrice = currentPrice * 1.02;
        break;
      case 'wide':
        lowerPrice = currentPrice * 0.8;
        upperPrice = currentPrice * 1.2;
        break;
      default: // balanced
        lowerPrice = currentPrice * 0.95;
        upperPrice = currentPrice * 1.05;
    }

    // Build transaction via Gateway
    const result = await gatewayClient.openPosition({
      dex: intent.dex,
      pool: pool.address,
      lowerPrice,
      upperPrice,
      tokenAAmount: intent.amount / 2,
      tokenBAmount: intent.amount / 2,
    });

    // Sign with wallet client (Privy or MPC)
    const signedTx = await walletClient.signTransaction(result.transaction);

    // Broadcast
    const txid = await broadcastTransaction(signedTx);

    // Calculate 1% protocol fee
    const feeBreakdown = createFeeBreakdown(intent.amount);

    return {
      success: true,
      message: `Position opened on ${intent.dex}`,
      data: {
        positionId: result.positionAddress,
        encryptedStrategy: encryptedStrategy.ciphertext.slice(0, 20) + '...',
        fees: {
          protocolFee: feeBreakdown.protocol.amount,
          protocolFeeBps: feeBreakdown.protocol.bps,
          treasury: feeBreakdown.protocol.recipient,
          netAmount: feeBreakdown.total.netAmount,
          grossAmount: feeBreakdown.total.grossAmount,
        },
      },
      transaction: {
        unsigned: result.transaction,
        signed: signedTx,
        txid,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to open position',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleClosePosition(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!gatewayClient || !walletClient) {
    return { success: false, message: 'Wallet not initialized' };
  }

  if (!intent.positionId || !intent.dex) {
    return { success: false, message: 'Missing positionId or dex' };
  }

  try {
    const result = await gatewayClient.closePosition({
      dex: intent.dex,
      positionId: intent.positionId,
    });

    const signedTx = await walletClient.signTransaction(result.transaction);
    const txid = await broadcastTransaction(signedTx);

    return {
      success: true,
      message: 'Position closed',
      transaction: { unsigned: result.transaction, signed: signedTx, txid },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to close position',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleCollectFees(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!gatewayClient || !walletClient) {
    return { success: false, message: 'Wallet not initialized' };
  }

  if (!intent.positionId || !intent.dex) {
    return { success: false, message: 'Missing positionId or dex' };
  }

  try {
    const result = await gatewayClient.collectFees({
      dex: intent.dex,
      positionId: intent.positionId,
    });

    const signedTx = await walletClient.signTransaction(result.transaction);
    const txid = await broadcastTransaction(signedTx);

    return {
      success: true,
      message: 'Fees collected',
      transaction: { unsigned: result.transaction, signed: signedTx, txid },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to collect fees',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function broadcastTransaction(signedTx: string): Promise<string> {
  const txBuffer = Buffer.from(signedTx, 'base64');
  const txid = await connection.sendRawTransaction(txBuffer);
  await connection.confirmTransaction(txid);
  return txid;
}

// ============ Server Start ============

export async function startServer() {
  try {
    console.log('🚀 LP Agent Toolkit - Initializing...');
    connection = new Connection(config.solana.rpc, 'confirmed');

    // Eagerly load modules to catch errors at startup
    console.log('📦 Pre-loading modules...');
    await loadSwapModule();
    await loadLpModule();

    const port = config.agent.port;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 Gateway: ${config.gateway.url}`);
    console.log(`🔐 MPC Provider: ${config.privy.enabled ? 'Privy' : 'Portal'}`);
    console.log(`🛡️  Privacy: Arcium MXE`);
    console.log(`🌐 Network: mainnet`);
    console.log(`🚪 Port: ${port}`);
    console.log(`📦 LP Module: ${lpPipeline ? 'loaded' : 'NOT LOADED'}`);
    console.log(`📦 Swap Module: ${jupiterClient ? 'loaded' : 'NOT LOADED'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    serve({
      fetch: app.fetch,
      port: port,
    });

    console.log(`\n✅ Server running on http://0.0.0.0:${port}`);
  } catch (err) {
    console.error('💥 FATAL: Server failed to start!', err);
    process.exit(1);
  }
}

export default app;

// Debug endpoint to test LP module loading
app.get('/debug/lp', async (c) => {
  console.log('🔍 Debug: Testing LP module load...');
  let error: string | null = null;
  let modKeys: string[] = [];
  
  try {
    const mod = await import('../lp/index.js');
    modKeys = Object.keys(mod);
    if (mod.lpPipeline) {
      lpPipeline = mod.lpPipeline;
    }
  } catch (e) {
    error = (e as Error).message + '\n' + (e as Error).stack;
  }
  
  return c.json({
    lpLoaded: !!lpPipeline,
    lpPipelineType: typeof lpPipeline,
    lpPipelineValue: lpPipeline ? 'exists' : String(lpPipeline),
    moduleKeys: modKeys,
    swapLoaded: !!jupiterClient,
    error,
    timestamp: new Date().toISOString()
  });
});
