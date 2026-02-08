/**
 * Unified LP API Routes
 * 
 * DEX-agnostic LP operations - we pick the best pool automatically
 */

import { Hono } from 'hono';
import { fetchUnifiedPools, findBestPool, type UnifiedPool } from '../services/unified-pools.js';
import { loadWalletById, getWalletBalance } from '../services/wallet-service.js';
import { executeLp, type LpExecuteParams } from '../services/lp-service.js';
import { executeOrcaLp } from '../services/orca-service.js';
import type { TipSpeed } from '../jito/index.js';

// Strategy to bin offset mapping (Meteora)
const STRATEGY_BIN_OFFSET = {
  concentrated: 5,  // ±5 bins around current price
  wide: 20,         // ±20 bins for more range
} as const;

const app = new Hono();

interface AddLpRequest {
  walletId: string;
  pair?: string;           // e.g., "SOL-USDC" - we find best pool
  poolAddress?: string;    // or specify exact pool
  amountSol: number;
  strategy?: 'concentrated' | 'wide';
  riskTolerance?: 'low' | 'medium' | 'high';
}

/**
 * GET /unified/pools
 * 
 * Returns top pools across all DEXes, sorted by risk-adjusted yield
 */
app.get('/pools', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const minTvl = parseFloat(c.req.query('minTvl') || '50000');
    const maxRisk = parseInt(c.req.query('maxRisk') || '7');
    const dex = c.req.query('dex') as 'meteora' | 'orca' | 'all' | undefined || 'all';
    const sortBy = c.req.query('sortBy') as 'apr' | 'tvl' | 'riskAdjustedYield' | 'volume24h' | undefined || 'riskAdjustedYield';
    const tokenFilter = c.req.query('token');

    const pools = await fetchUnifiedPools({
      limit,
      minTvl,
      maxRiskScore: maxRisk,
      dexFilter: dex,
      sortBy,
      tokenFilter,
    });

    return c.json({
      success: true,
      count: pools.length,
      filters: { limit, minTvl, maxRisk, dex, sortBy, tokenFilter },
      pools: pools.map(p => ({
        ...p,
        humanYield: `$${p.dailyYieldPer100Usd.toFixed(2)}/day per $100`,
      })),
    });
  } catch (error: any) {
    console.error('[Unified LP] GET /pools error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /unified/pools/best
 * 
 * Find best pool for a token pair
 */
app.get('/pools/best', async (c) => {
  try {
    const tokenA = c.req.query('tokenA');
    const tokenB = c.req.query('tokenB');
    
    if (!tokenA || !tokenB) {
      return c.json({
        success: false,
        error: 'Missing tokenA or tokenB query params',
        example: '/unified/pools/best?tokenA=SOL&tokenB=USDC',
      }, 400);
    }

    const bestPool = await findBestPool(tokenA, tokenB);
    
    if (!bestPool) {
      return c.json({
        success: false,
        pair: `${tokenA}-${tokenB}`,
        error: `No pool found for ${tokenA}-${tokenB}`,
      }, 404);
    }

    return c.json({
      success: true,
      pair: `${tokenA}-${tokenB}`,
      bestPool: {
        ...bestPool,
        humanYield: `$${bestPool.dailyYieldPer100Usd.toFixed(2)}/day per $100`,
        reason: `Highest APR (${bestPool.apr.toFixed(1)}%) on ${bestPool.dex}`,
      },
    });
  } catch (error: any) {
    console.error('[Unified LP] GET /pools/best error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /unified/lp/add
 * 
 * Add LP to best pool for a pair (or specified pool)
 * This is the main agent-facing endpoint
 */
app.post('/lp/add', async (c) => {
  try {
    const body = await c.req.json() as AddLpRequest;
    const { walletId, pair, poolAddress, amountSol, strategy = 'concentrated', riskTolerance = 'medium' } = body;

    if (!walletId) {
      return c.json({ success: false, error: 'walletId required' }, 400);
    }
    if (!pair && !poolAddress) {
      return c.json({ success: false, error: 'Either pair or poolAddress required' }, 400);
    }
    if (!amountSol || amountSol <= 0) {
      return c.json({ success: false, error: 'amountSol must be positive' }, 400);
    }

    // 1. Find the pool (either by address or by pair)
    let targetPool: UnifiedPool | undefined;
    
    if (poolAddress) {
      // Look up pool by address in our unified pools
      const allPools = await fetchUnifiedPools({ limit: 100, minTvl: 1000 });
      targetPool = allPools.find(p => p.address === poolAddress);
      if (!targetPool) {
        return c.json({ 
          success: false, 
          error: `Pool ${poolAddress} not found in top pools`,
          hint: 'Use GET /unified/pools to see available pools',
        }, 404);
      }
    } else if (pair) {
      // Parse pair like "SOL-USDC"
      const [tokenA, tokenB] = pair.split('-');
      if (!tokenA || !tokenB) {
        return c.json({ success: false, error: 'Invalid pair format. Use TOKEN-TOKEN (e.g., SOL-USDC)' }, 400);
      }
      const foundPool = await findBestPool(tokenA, tokenB);
      if (!foundPool) {
        return c.json({ success: false, error: `No pool found for ${pair}` }, 404);
      }
      targetPool = foundPool;
    }

    if (!targetPool) {
      return c.json({ success: false, error: 'Could not determine target pool' }, 400);
    }

    // 2. Load wallet
    const { wallet } = await loadWalletById(walletId);
    if (!wallet) {
      return c.json({ success: false, error: `Wallet ${walletId} not found` }, 404);
    }

    // 3. Check balance
    const FEE_RESERVE = 0.15;
    const walletAddress = wallet.address;
    const balance = await getWalletBalance(walletAddress);
    if (balance.sol < amountSol + FEE_RESERVE) {
      return c.json({
        success: false,
        error: `Insufficient balance. Have ${balance.sol.toFixed(4)} SOL, need ${amountSol} + ${FEE_RESERVE} for fees`,
      }, 400);
    }

    // 4. Route to correct DEX executor
    const tipSpeed: TipSpeed = 'fast';
    const slippageBps = strategy === 'concentrated' ? 300 : 500;

    // Create signing functions from Privy wallet
    const signTransaction = async (tx: string) => {
      const signed = await wallet.signTransaction({ transaction: tx });
      return signed.signedTransaction;
    };

    try {
      if (targetPool.dex === 'meteora') {
        const binOffset = STRATEGY_BIN_OFFSET[strategy];
        const params: LpExecuteParams = {
          walletId,
          walletAddress,
          poolAddress: targetPool.address,
          amountSol,
          minBinId: -binOffset,
          maxBinId: binOffset,
          strategy,
          shape: 'spot', // Default to spot distribution
          tipSpeed,
          slippageBps,
          signTransaction,
        };
        const result = await executeLp(params);

        return c.json({
          success: true,
          dex: 'meteora',
          pool: targetPool.name,
          poolAddress: targetPool.address,
          amountSol,
          strategy,
          result,
        });
      } else if (targetPool.dex === 'orca') {
        const result = await executeOrcaLp({
          walletId,
          walletAddress,
          poolAddress: targetPool.address,
          amountSol,
          strategy,
          tipSpeed,
          slippageBps,
          signTransaction,
        });

        return c.json({
          success: true,
          dex: 'orca',
          pool: targetPool.name,
          poolAddress: targetPool.address,
          amountSol,
          strategy,
          result,
        });
      } else {
        return c.json({
          success: false,
          error: `DEX ${targetPool.dex} not yet supported for LP execution`,
          pool: targetPool,
        }, 400);
      }
    } catch (error: any) {
      console.error('[Unified LP] Execution error:', error);
      return c.json({
        success: false,
        error: `LP execution failed: ${error.message}`,
        pool: targetPool.name,
        dex: targetPool.dex,
      }, 500);
    }
  } catch (error: any) {
    console.error('[Unified LP] POST /lp/add error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
