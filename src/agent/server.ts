/**
 * LP Agent API Server
 * 
 * REST API for AI agents to manage LP positions across Solana DEXs
 * with MPC custody and Arcium privacy
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection } from '@solana/web3.js';

import { config } from '../config';
import { GatewayClient } from '../gateway';
import { MPCClient } from '../mpc';
import { arciumPrivacy } from '../privacy';
import { parseIntent, describeIntent } from './intent';
import type { AgentResponse, LPIntent, PoolOpportunity } from './types';

const app = new Hono();

// Middleware
app.use('*', cors());

// State
let mpcClient: MPCClient | null = null;
let gatewayClient: GatewayClient | null = null;
let connection: Connection;

// ============ Health & Status ============

app.get('/', (c) => c.json({ 
  name: 'LP Agent Toolkit',
  version: '2.0.0',
  status: 'running',
  features: ['MPC Custody', 'Arcium Privacy', 'Multi-DEX LP'],
}));

app.get('/health', async (c) => {
  const gatewayOk = gatewayClient ? await gatewayClient.healthCheck() : false;
  const mpcOk = mpcClient?.isWalletLoaded() ?? false;
  const arciumOk = arciumPrivacy.isInitialized();

  return c.json({
    status: gatewayOk && mpcOk ? 'healthy' : 'degraded',
    components: {
      gateway: gatewayOk ? 'connected' : 'disconnected',
      mpc: mpcOk ? 'wallet_loaded' : 'no_wallet',
      arcium: arciumOk ? 'initialized' : 'not_initialized',
    },
    timestamp: new Date().toISOString(),
  });
});

// ============ Wallet Management ============

app.post('/wallet/create', async (c) => {
  try {
    mpcClient = new MPCClient();
    const wallet = await mpcClient.generateWallet();
    
    // Initialize gateway with new wallet address
    gatewayClient = new GatewayClient(wallet.addresses.solana);

    return c.json<AgentResponse>({
      success: true,
      message: 'MPC wallet created. Fund this address to start LPing.',
      data: {
        address: wallet.addresses.solana,
        // Don't expose key share in response - store it securely
        walletId: wallet.id,
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to create wallet',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.post('/wallet/load', async (c) => {
  try {
    const { address, share, id } = await c.req.json();
    
    if (!address || !share) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing address or share',
      }, 400);
    }

    mpcClient = new MPCClient();
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

app.get('/wallet/address', (c) => {
  if (!mpcClient?.isWalletLoaded()) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded',
    }, 400);
  }

  return c.json<AgentResponse>({
    success: true,
    message: 'Wallet address',
    data: { address: mpcClient.getAddress() },
  });
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

// ============ Handlers ============

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

async function handleOpenPosition(intent: LPIntent): Promise<AgentResponse> {
  if (!gatewayClient || !mpcClient) {
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

    // Sign with MPC
    const signedTx = await mpcClient.signTransaction(result.transaction);

    // Broadcast
    const txid = await broadcastTransaction(signedTx);

    return {
      success: true,
      message: `Position opened on ${intent.dex}`,
      data: {
        positionId: result.positionAddress,
        encryptedStrategy: encryptedStrategy.ciphertext.slice(0, 20) + '...',
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
  if (!gatewayClient || !mpcClient) {
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

    const signedTx = await mpcClient.signTransaction(result.transaction);
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
  if (!gatewayClient || !mpcClient) {
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

    const signedTx = await mpcClient.signTransaction(result.transaction);
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

export function startServer() {
  connection = new Connection(config.solana.rpc);
  
  console.log('🚀 LP Agent Toolkit');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Gateway: ${config.gateway.url}`);
  console.log(`🔐 MPC: Portal Enclave`);
  console.log(`🛡️  Privacy: Arcium MXE`);
  console.log(`🌐 Network: ${config.gateway.network}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  serve({
    fetch: app.fetch,
    port: config.agent.port,
  });

  console.log(`\n✅ Server running on http://localhost:${config.agent.port}`);
}

export default app;
