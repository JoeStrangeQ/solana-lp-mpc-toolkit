/**
 * Raydium CLMM Routes
 * 
 * API endpoints for Raydium concentrated liquidity pools and positions.
 */

import { Hono } from 'hono';
import { getRaydiumClient } from '../raydium/client.js';
import { fetchRaydiumPositions, fetchRaydiumPosition } from '../raydium/positions.js';
import { getAggregatedPrice } from '../services/oracle-service.js';
import { ApiV3PoolInfoConcentratedItem } from '@raydium-io/raydium-sdk-v2';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const raydiumRoutes = new Hono();

/**
 * GET /raydium/pools
 * 
 * Fetch top Raydium CLMM pools by TVL
 */
raydiumRoutes.get('/pools', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10');
  const mint = c.req.query('mint') || SOL_MINT;
  const type = c.req.query('type') || 'concentrated'; // 'concentrated' or 'all'
  
  try {
    // Use direct Raydium API for reliable pool listing
    const apiUrl = new URL('https://api-v3.raydium.io/pools/info/mint');
    apiUrl.searchParams.set('mint1', mint);
    apiUrl.searchParams.set('poolType', type === 'all' ? 'all' : 'concentrated');
    apiUrl.searchParams.set('poolSortField', 'default');
    apiUrl.searchParams.set('sortType', 'desc');
    apiUrl.searchParams.set('pageSize', limit.toString());
    apiUrl.searchParams.set('page', '1');
    
    const response = await fetch(apiUrl.toString());
    const result = await response.json() as {
      success: boolean;
      data?: { count: number; data: any[] };
      msg?: string;
    };
    
    if (!result.success) {
      console.error('[Raydium] API error:', result.msg);
      return c.json({
        success: false,
        error: result.msg || 'Failed to fetch pools from Raydium API',
      }, 500);
    }
    
    const allPools = result.data?.data || [];
    
    // Filter to only Concentrated (CLMM) pools if requested
    const filteredPools = type === 'concentrated' 
      ? allPools.filter((p: any) => p.type === 'Concentrated')
      : allPools;
    
    const pools = filteredPools.slice(0, limit).map((pool: any) => ({
      id: pool.id,
      type: pool.type,
      pair: `${pool.mintA?.symbol || 'UNKNOWN'}-${pool.mintB?.symbol || 'UNKNOWN'}`,
      tokenA: {
        symbol: pool.mintA?.symbol || 'UNKNOWN',
        mint: pool.mintA?.address,
        decimals: pool.mintA?.decimals || 9,
      },
      tokenB: {
        symbol: pool.mintB?.symbol || 'UNKNOWN',
        mint: pool.mintB?.address,
        decimals: pool.mintB?.decimals || 6,
      },
      tvl: pool.tvl || 0,
      volume24h: pool.day?.volume || 0,
      apr: pool.day?.apr || 0,
      price: pool.price || 0,
      tickSpacing: pool.config?.tickSpacing || 1,
      feeRate: pool.feeRate || 0,
    }));
    
    return c.json({
      success: true,
      count: pools.length,
      pools,
    });
  } catch (error: any) {
    console.error('[Raydium] Error fetching pools:', error);
    return c.json({
      success: false,
      error: error?.message || 'Failed to fetch Raydium pools',
    }, 500);
  }
});

/**
 * GET /raydium/pool/:poolId
 * 
 * Fetch specific pool details
 */
raydiumRoutes.get('/pool/:poolId', async (c) => {
  const poolId = c.req.param('poolId');
  
  try {
    const raydium = await getRaydiumClient();
    
    const poolsData = await raydium.api.fetchPoolById({ ids: poolId });
    const pool = poolsData[0] as ApiV3PoolInfoConcentratedItem | undefined;
    
    if (!pool) {
      return c.json({ success: false, error: 'Pool not found' }, 404);
    }
    
    return c.json({
      success: true,
      pool: {
        id: pool.id,
        pair: `${pool.mintA?.symbol || 'UNKNOWN'}-${pool.mintB?.symbol || 'UNKNOWN'}`,
        tokenA: {
          symbol: pool.mintA?.symbol || 'UNKNOWN',
          mint: pool.mintA?.address,
          decimals: pool.mintA?.decimals || 9,
        },
        tokenB: {
          symbol: pool.mintB?.symbol || 'UNKNOWN',
          mint: pool.mintB?.address,
          decimals: pool.mintB?.decimals || 6,
        },
        tvl: pool.tvl || 0,
        volume24h: pool.day?.volume || 0,
        apr: (pool.day?.apr || 0) * 100,
        price: pool.price || 0,
        tickSpacing: pool.config?.tickSpacing || 1,
        feeRate: pool.config?.tradeFeeRate || 0,
      },
    });
  } catch (error: any) {
    console.error('[Raydium] Error fetching pool:', error);
    return c.json({
      success: false,
      error: error?.message || 'Failed to fetch pool',
    }, 500);
  }
});

/**
 * GET /raydium/positions
 * 
 * Fetch Raydium CLMM positions for a wallet address
 */
raydiumRoutes.get('/positions', async (c) => {
  const address = c.req.query('address');
  
  if (!address) {
    return c.json({
      success: false,
      error: 'Missing address query parameter',
    }, 400);
  }
  
  try {
    const positions = await fetchRaydiumPositions(address);
    
    // Enrich with USD values
    let solPrice = 0;
    try {
      const priceData = await getAggregatedPrice(SOL_MINT);
      solPrice = priceData.price;
    } catch {
      solPrice = 0;
    }
    
    const enrichedPositions = positions.map(pos => {
      // Estimate USD value (rough approximation)
      const usdValue = pos.tokenA.symbol === 'SOL' 
        ? pos.amountA * solPrice + pos.amountB
        : pos.tokenB.symbol === 'SOL'
          ? pos.amountB * solPrice + pos.amountA
          : pos.amountA + pos.amountB;
      
      return {
        ...pos,
        estimatedValueUsd: usdValue,
      };
    });
    
    return c.json({
      success: true,
      count: enrichedPositions.length,
      positions: enrichedPositions,
    });
  } catch (error: any) {
    console.error('[Raydium] Error fetching positions:', error);
    return c.json({
      success: false,
      error: error?.message || 'Failed to fetch positions',
    }, 500);
  }
});

/**
 * GET /raydium/position/:mint
 * 
 * Fetch single position by NFT mint
 */
raydiumRoutes.get('/position/:mint', async (c) => {
  const mint = c.req.param('mint');
  
  try {
    const position = await fetchRaydiumPosition(mint);
    
    if (!position) {
      return c.json({ success: false, error: 'Position not found' }, 404);
    }
    
    // Get SOL price for USD value
    let solPrice = 0;
    try {
      const priceData = await getAggregatedPrice(SOL_MINT);
      solPrice = priceData.price;
    } catch {
      solPrice = 0;
    }
    
    const usdValue = position.tokenA.symbol === 'SOL'
      ? position.amountA * solPrice + position.amountB
      : position.tokenB.symbol === 'SOL'
        ? position.amountB * solPrice + position.amountA
        : position.amountA + position.amountB;
    
    return c.json({
      success: true,
      position: {
        ...position,
        estimatedValueUsd: usdValue,
      },
    });
  } catch (error: any) {
    console.error('[Raydium] Error fetching position:', error);
    return c.json({
      success: false,
      error: error?.message || 'Failed to fetch position',
    }, 500);
  }
});

export default raydiumRoutes;
