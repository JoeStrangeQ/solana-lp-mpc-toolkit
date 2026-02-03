/**
 * LP Toolkit REST API Server
 * Enables agent-to-agent usage over HTTP
 * 
 * Run: npx tsx src/api/server.ts
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection, PublicKey } from '@solana/web3.js';

// Import toolkit modules
import { ArciumPrivacyService, ARCIUM_DEVNET_CONFIG } from '../lp-toolkit/services/arciumPrivacy';
import { parseIntent } from '../lp-toolkit/api/intentParser';
import { formatPoolsForChat, formatPositionsForChat } from '../lp-toolkit/adapters/types';
import { buildAddLiquidityTx, buildRemoveLiquidityTx, describeTx } from './txBuilder';

// ============ Configuration ============

const PORT = process.env.PORT || 3456;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

const app = new Hono();
const connection = new Connection(SOLANA_RPC, 'confirmed');

// ============ Middleware ============

app.use('*', cors());

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} - ${c.res.status} (${ms}ms)`);
});

// ============ Health & Info ============

app.get('/', (c) => {
  return c.json({
    name: 'Solana LP MPC Toolkit API',
    version: '1.0.0',
    description: 'Privacy-preserving LP operations for AI agents',
    docs: '/v1/docs',
    endpoints: {
      health: 'GET /v1/health',
      pools: 'GET /v1/pools/scan',
      intent: 'POST /v1/intent/parse',
      encrypt: 'POST /v1/encrypt/strategy',
      positions: 'GET /v1/positions/:wallet',
      txAdd: 'POST /v1/tx/add-liquidity',
      txRemove: 'POST /v1/tx/remove-liquidity',
      txDescribe: 'POST /v1/tx/describe',
    },
  });
});

app.get('/v1/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    arcium: {
      cluster: ARCIUM_DEVNET_CONFIG.clusterOffset,
      mxeKey: ARCIUM_DEVNET_CONFIG.mxePublicKeyHex.slice(0, 16) + '...',
    },
    dexes: ['meteora', 'orca', 'raydium', 'saber', 'lifinity', 'crema', 'fluxbeam', 'invariant'],
  });
});

// ============ Pool Discovery ============

app.get('/v1/pools/scan', async (c) => {
  const tokenA = c.req.query('tokenA') || 'SOL';
  const tokenB = c.req.query('tokenB') || 'USDC';
  const limit = parseInt(c.req.query('limit') || '10');
  const venue = c.req.query('venue'); // optional filter

  try {
    // Fetch pools from available DEXs
    const pools: any[] = [];
    
    // Meteora DLMM
    if (!venue || venue === 'meteora') {
      try {
        const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
        const data = await response.json();
        if (Array.isArray(data)) {
          const filtered = data
            .filter((p: any) => {
              const name = (p.name || '').toUpperCase();
              return name.includes(tokenA.toUpperCase()) && name.includes(tokenB.toUpperCase());
            })
            .slice(0, 20)
            .map((p: any) => ({
              venue: 'meteora',
              address: p.address,
              name: p.name,
              apy: p.apr || 0,
              apy7d: p.apr_7d || p.apr || 0,
              tvl: p.liquidity || 0,
              volume24h: p.trade_volume_24h || 0,
              fee: p.base_fee_percentage || 0,
            }));
          pools.push(...filtered);
        }
      } catch (e) {
        console.warn('Meteora API error:', e);
      }
    }

    // Orca Whirlpool
    if (!venue || venue === 'orca') {
      try {
        const response = await fetch('https://api.mainnet.orca.so/v1/whirlpool/list');
        const data = await response.json();
        if (data.whirlpools) {
          const filtered = data.whirlpools
            .filter((p: any) => {
              const symA = p.tokenA?.symbol?.toUpperCase() || '';
              const symB = p.tokenB?.symbol?.toUpperCase() || '';
              return (symA.includes(tokenA.toUpperCase()) || symB.includes(tokenA.toUpperCase())) &&
                     (symA.includes(tokenB.toUpperCase()) || symB.includes(tokenB.toUpperCase()));
            })
            .slice(0, 20)
            .map((p: any) => ({
              venue: 'orca',
              address: p.address,
              name: `${p.tokenA?.symbol}-${p.tokenB?.symbol}`,
              apy: p.feeApr || 0,
              tvl: p.tvl || 0,
              volume24h: p.volume?.day || 0,
              fee: (p.lpFeeRate || 0) * 100,
            }));
          pools.push(...filtered);
        }
      } catch (e) {
        console.warn('Orca API error:', e);
      }
    }

    // Sort by APY and limit
    pools.sort((a, b) => b.apy - a.apy);
    const topPools = pools.slice(0, limit);

    return c.json({
      success: true,
      query: { tokenA, tokenB, limit, venue },
      count: topPools.length,
      pools: topPools,
      chatDisplay: formatPoolsForChat(topPools.map(p => ({
        ...p,
        tokenA: { mint: '', symbol: tokenA, decimals: 9 },
        tokenB: { mint: '', symbol: tokenB, decimals: 6 },
        apy7d: p.apy7d || p.apy,
      }))),
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
      suggestion: 'Try specifying a venue parameter: ?venue=meteora',
    }, 500);
  }
});

// ============ Intent Parsing ============

app.post('/v1/intent/parse', async (c) => {
  try {
    const body = await c.req.json();
    const { text } = body;

    if (!text) {
      return c.json({
        success: false,
        error: 'Missing required field: text',
        example: { text: 'Add $500 to the best SOL-USDC pool' },
      }, 400);
    }

    const intent = parseIntent(text);

    return c.json({
      success: true,
      input: text,
      intent,
      explanation: explainIntent(intent),
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

function explainIntent(intent: any): string {
  if (intent.action === 'add_liquidity') {
    return `Add liquidity: ${intent.totalValueUSD ? '$' + intent.totalValueUSD : intent.amountA + ' ' + intent.tokenA} to ${intent.tokenA}-${intent.tokenB} pool`;
  }
  if (intent.action === 'remove_liquidity') {
    return `Remove ${intent.percentage || 100}% liquidity from position`;
  }
  if (intent.action === 'scan') {
    return `Scan for best ${intent.tokenA}-${intent.tokenB} pools`;
  }
  return 'Unknown intent';
}

// ============ Encryption ============

app.post('/v1/encrypt/strategy', async (c) => {
  try {
    const body = await c.req.json();
    const { ownerPubkey, strategy } = body;

    if (!ownerPubkey || !strategy) {
      return c.json({
        success: false,
        error: 'Missing required fields: ownerPubkey, strategy',
        example: {
          ownerPubkey: 'Your wallet public key',
          strategy: {
            tokenA: 'SOL',
            tokenB: 'USDC',
            totalValueUSD: 500,
            strategy: 'concentrated',
          },
        },
      }, 400);
    }

    const privacy = new ArciumPrivacyService(new PublicKey(ownerPubkey));
    await privacy.initializeDevnet();

    const encrypted = privacy.encryptStrategy(strategy);

    return c.json({
      success: true,
      encrypted,
      decryptionNote: 'Only the owner with the matching private key can decrypt',
      arciumCluster: ARCIUM_DEVNET_CONFIG.clusterOffset,
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

// ============ Positions ============

app.get('/v1/positions/:wallet', async (c) => {
  const wallet = c.req.param('wallet');

  try {
    const pubkey = new PublicKey(wallet);
    
    // Fetch positions from Meteora
    const positions: any[] = [];
    
    try {
      const response = await fetch(`https://dlmm-api.meteora.ag/position/${wallet}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        positions.push(...data.map((p: any) => ({
          venue: 'meteora',
          positionId: p.address,
          poolName: p.pair_name || 'Unknown',
          valueUSD: p.total_value_usd || 0,
          unclaimedFeesUSD: p.unclaimed_fee_usd || 0,
          inRange: true,
        })));
      }
    } catch (e) {
      // Continue
    }

    const totalValue = positions.reduce((sum, p) => sum + (p.valueUSD || 0), 0);
    const totalFees = positions.reduce((sum, p) => sum + (p.unclaimedFeesUSD || 0), 0);

    return c.json({
      success: true,
      wallet,
      count: positions.length,
      totalValueUSD: totalValue,
      totalUnclaimedFeesUSD: totalFees,
      positions,
      chatDisplay: positions.length > 0 
        ? `📊 ${positions.length} positions | $${totalValue.toFixed(2)} value | $${totalFees.toFixed(2)} unclaimed`
        : '📭 No LP positions found',
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
      suggestion: 'Ensure wallet is a valid Solana public key',
    }, 500);
  }
});

// ============ Transaction Building (Wallet-less) ============

app.post('/v1/tx/add-liquidity', async (c) => {
  try {
    const body = await c.req.json();
    const { userPubkey, poolAddress, venue, tokenA, tokenB, amountA, amountB, slippageBps } = body;

    if (!userPubkey || !tokenA || !tokenB) {
      return c.json({
        success: false,
        error: 'Missing required fields: userPubkey, tokenA, tokenB',
        example: {
          userPubkey: 'YourWalletPubkey',
          poolAddress: 'optional - auto-selects best',
          venue: 'meteora',
          tokenA: 'SOL',
          tokenB: 'USDC',
          amountA: 1.0,
          amountB: 150,
        },
      }, 400);
    }

    const result = await buildAddLiquidityTx(connection, {
      userPubkey,
      poolAddress: poolAddress || 'auto',
      venue: venue || 'meteora',
      tokenA,
      tokenB,
      amountA: amountA || 0,
      amountB: amountB || 0,
      slippageBps,
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error,
      }, 500);
    }

    return c.json({
      success: true,
      transaction: result.transaction,
      instructions: result.instructions,
      signing: {
        note: 'Transaction is unsigned. Sign with your wallet and submit to Solana.',
        methods: [
          'Phantom: signTransaction()',
          'Solflare: signTransaction()',
          'CLI: solana sign <tx>',
        ],
      },
    });

  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

app.post('/v1/tx/remove-liquidity', async (c) => {
  try {
    const body = await c.req.json();
    const { userPubkey, positionId, venue, percentage } = body;

    if (!userPubkey || !positionId) {
      return c.json({
        success: false,
        error: 'Missing required fields: userPubkey, positionId',
        example: {
          userPubkey: 'YourWalletPubkey',
          positionId: 'PositionAddress',
          venue: 'meteora',
          percentage: 100,
        },
      }, 400);
    }

    const result = await buildRemoveLiquidityTx(connection, {
      userPubkey,
      positionId,
      venue: venue || 'meteora',
      percentage,
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error,
      }, 500);
    }

    return c.json({
      success: true,
      transaction: result.transaction,
      instructions: result.instructions,
    });

  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

app.post('/v1/tx/describe', async (c) => {
  try {
    const body = await c.req.json();
    const { serializedTx } = body;

    if (!serializedTx) {
      return c.json({
        success: false,
        error: 'Missing serializedTx',
      }, 400);
    }

    const description = describeTx(serializedTx);
    return c.json({
      success: true,
      description,
    });

  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

// ============ API Documentation ============

app.get('/v1/docs', (c) => {
  return c.json({
    title: 'LP Toolkit API for AI Agents',
    version: '1.0.0',
    baseUrl: `http://localhost:${PORT}`,
    
    endpoints: [
      {
        method: 'GET',
        path: '/v1/health',
        description: 'Health check and service info',
      },
      {
        method: 'GET',
        path: '/v1/pools/scan',
        description: 'Find best LP pools across DEXs',
        params: {
          tokenA: 'First token symbol (default: SOL)',
          tokenB: 'Second token symbol (default: USDC)',
          limit: 'Max results (default: 10)',
          venue: 'Filter by DEX: meteora, orca, raydium',
        },
        example: '/v1/pools/scan?tokenA=SOL&tokenB=USDC&limit=5',
      },
      {
        method: 'POST',
        path: '/v1/intent/parse',
        description: 'Parse natural language LP intent',
        body: { text: 'Add $500 to the best SOL-USDC pool' },
      },
      {
        method: 'POST',
        path: '/v1/encrypt/strategy',
        description: 'Encrypt LP strategy with Arcium MPC',
        body: {
          ownerPubkey: 'wallet_pubkey',
          strategy: { tokenA: 'SOL', tokenB: 'USDC', totalValueUSD: 500 },
        },
      },
      {
        method: 'GET',
        path: '/v1/positions/:wallet',
        description: 'Get LP positions for a wallet',
        example: '/v1/positions/YourWalletPubkey',
      },
    ],
    
    agentUsage: {
      description: 'How another AI agent can use this API',
      example: `
// 1. Find best pool
const pools = await fetch('${`http://localhost:${PORT}`}/v1/pools/scan?tokenA=SOL&tokenB=USDC');

// 2. Parse user intent
const intent = await fetch('${`http://localhost:${PORT}`}/v1/intent/parse', {
  method: 'POST',
  body: JSON.stringify({ text: 'Add $500 to SOL-USDC' })
});

// 3. Encrypt strategy (privacy)
const encrypted = await fetch('${`http://localhost:${PORT}`}/v1/encrypt/strategy', {
  method: 'POST', 
  body: JSON.stringify({ ownerPubkey: 'xxx', strategy: intent })
});
      `.trim(),
    },
  });
});

// ============ Start Server ============

console.log(`
🦀 LP Toolkit API Server
========================
Port: ${PORT}
RPC: ${SOLANA_RPC}
Arcium: Cluster ${ARCIUM_DEVNET_CONFIG.clusterOffset}

Endpoints:
  GET  /v1/health
  GET  /v1/pools/scan
  POST /v1/intent/parse
  POST /v1/encrypt/strategy
  GET  /v1/positions/:wallet
  GET  /v1/docs

Ready for agent-to-agent requests!
`);

serve({
  fetch: app.fetch,
  port: Number(PORT),
});

export default app;
