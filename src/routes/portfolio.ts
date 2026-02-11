/**
 * Portfolio REST API Routes
 * 
 * Exposes portfolio data via REST for external agents/tools
 */
import { Hono } from 'hono';
import { stats } from '../services/stats.js';
import { getAggregatedPrice } from '../services/oracle-service.js';
import { getUserPositions } from '../onboarding/index.js';
import { getOrcaPositionsForWallet } from '../services/orca-service.js';
import { fetchRaydiumPositions } from '../raydium/positions.js';

const app = new Hono();

// Known token prices cache (refreshed each request)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';

interface PortfolioResponse {
  success: boolean;
  walletAddress: string;
  solPrice: number;
  totalValueUsd: number;
  totalFeesUsd: number;
  positionCount: number;
  inRangeCount: number;
  outOfRangeCount: number;
  byDex: {
    meteora: { count: number; valueUsd: number; feesUsd: number };
    orca: { count: number; valueUsd: number; feesUsd: number };
    raydium: { count: number; valueUsd: number; feesUsd: number };
  };
  positions: Array<{
    pool: string;
    poolAddress: string;
    dex: string;
    valueUsd: number;
    feesUsd: number;
    inRange: boolean;
  }>;
}

/**
 * Get USD price for a token mint
 * Returns price or 0 if not found
 */
async function getTokenPriceUsd(mint: string, priceCache: Map<string, number>): Promise<number> {
  if (!mint) return 0;
  
  // Check cache first
  if (priceCache.has(mint)) {
    return priceCache.get(mint)!;
  }
  
  try {
    const result = await getAggregatedPrice(mint);
    priceCache.set(mint, result.price);
    return result.price;
  } catch (e) {
    console.warn(`[Portfolio] Failed to fetch price for ${mint}`);
    return 0;
  }
}

/**
 * Collect all unique token mints from positions
 */
function collectTokenMints(meteoraPositions: any[], orcaPositions: any[], raydiumPositions: any[]): Set<string> {
  const mints = new Set<string>();
  
  for (const pos of meteoraPositions) {
    if (pos.tokenXMint) mints.add(pos.tokenXMint);
    if (pos.tokenYMint) mints.add(pos.tokenYMint);
  }
  
  for (const pos of orcaPositions) {
    if (pos.tokenA?.mint) mints.add(pos.tokenA.mint);
    if (pos.tokenB?.mint) mints.add(pos.tokenB.mint);
  }
  
  for (const pos of raydiumPositions) {
    if (pos.tokenA?.mint) mints.add(pos.tokenA.mint);
    if (pos.tokenB?.mint) mints.add(pos.tokenB.mint);
  }
  
  return mints;
}

app.get('/:walletAddress', async (c) => {
  const walletAddress = c.req.param('walletAddress');
  stats.requests.total++;
  stats.requests.byEndpoint['/portfolio/:walletAddress'] = (stats.requests.byEndpoint['/portfolio/:walletAddress'] || 0) + 1;
  
  if (!walletAddress || walletAddress.length < 32) {
    return c.json({ success: false, error: 'Invalid wallet address' }, 400);
  }
  
  try {
    // Price cache for this request
    const priceCache = new Map<string, number>();
    
    // Fetch SOL price first (used as fallback and for display)
    let solPrice = 80; // Default fallback
    try {
      const priceResult = await getAggregatedPrice(SOL_MINT);
      solPrice = priceResult.price;
      priceCache.set(SOL_MINT, solPrice);
    } catch (e) {
      console.warn('[Portfolio] Failed to fetch SOL price, using default');
    }

    // Fetch all positions from all DEXes in parallel
    const [meteoraPositions, orcaPositions, raydiumPositions] = await Promise.all([
      getUserPositions(walletAddress).catch(() => []),
      getOrcaPositionsForWallet(walletAddress).catch(() => []),
      fetchRaydiumPositions(walletAddress).catch(() => []),
    ]);

    const totalPositions = meteoraPositions.length + orcaPositions.length + raydiumPositions.length;

    if (totalPositions === 0) {
      return c.json({
        success: true,
        walletAddress,
        solPrice,
        totalValueUsd: 0,
        totalFeesUsd: 0,
        positionCount: 0,
        inRangeCount: 0,
        outOfRangeCount: 0,
        byDex: {
          meteora: { count: 0, valueUsd: 0, feesUsd: 0 },
          orca: { count: 0, valueUsd: 0, feesUsd: 0 },
          raydium: { count: 0, valueUsd: 0, feesUsd: 0 },
        },
        positions: [],
      });
    }

    // Collect all token mints and fetch prices in parallel
    const tokenMints = collectTokenMints(meteoraPositions, orcaPositions, raydiumPositions);
    const pricePromises = Array.from(tokenMints).map(async (mint) => {
      try {
        const result = await getAggregatedPrice(mint);
        priceCache.set(mint, result.price);
      } catch (e) {
        // If we can't get price, check if it's a SOL-like token
        if (mint === JITOSOL_MINT) {
          priceCache.set(mint, solPrice * 1.05); // JitoSOL ~5% premium over SOL
        }
      }
    });
    await Promise.all(pricePromises);

    // Calculate Meteora values with proper token prices
    let meteoraValueUsd = 0;
    let meteoraFeesUsd = 0;
    let meteoraInRange = 0;
    const meteoraPositionList: PortfolioResponse['positions'] = [];

    for (const pos of meteoraPositions) {
      const tokenXAmount = pos.amounts?.tokenX?.amount || 0;
      const tokenYAmount = pos.amounts?.tokenY?.amount || 0;
      const tokenXMint = pos.tokenXMint || '';
      const tokenYMint = pos.tokenYMint || '';
      
      // Get actual token prices
      const tokenXPrice = priceCache.get(tokenXMint) || 0;
      const tokenYPrice = priceCache.get(tokenYMint) || 0;
      
      // Calculate USD value with correct prices
      const valueUsd = tokenXAmount * tokenXPrice + tokenYAmount * tokenYPrice;
      meteoraValueUsd += valueUsd;

      // Parse fees with correct prices
      const feeX = parseFloat((pos.fees?.tokenX || '0').toString().replace(/[^0-9.]/g, ''));
      const feeY = parseFloat((pos.fees?.tokenY || '0').toString().replace(/[^0-9.]/g, ''));
      const feesUsd = feeX * tokenXPrice + feeY * tokenYPrice;
      meteoraFeesUsd += feesUsd;

      if (pos.inRange) meteoraInRange++;

      meteoraPositionList.push({
        pool: pos.pool || 'Unknown',
        poolAddress: pos.poolAddress || '',
        dex: 'meteora',
        valueUsd,
        feesUsd,
        inRange: pos.inRange || false,
      });
    }

    // Calculate Orca values with proper token prices
    let orcaValueUsd = 0;
    let orcaFeesUsd = 0;
    let orcaInRange = 0;
    const orcaPositionList: PortfolioResponse['positions'] = [];

    for (const pos of orcaPositions) {
      const tokenAAmount = parseFloat(pos.tokenA?.amount || '0');
      const tokenBAmount = parseFloat(pos.tokenB?.amount || '0');
      const tokenAMint = pos.tokenA?.mint || '';
      const tokenBMint = pos.tokenB?.mint || '';
      
      const tokenAPrice = priceCache.get(tokenAMint) || 0;
      const tokenBPrice = priceCache.get(tokenBMint) || 0;
      
      const valueUsd = tokenAAmount * tokenAPrice + tokenBAmount * tokenBPrice;
      orcaValueUsd += valueUsd;

      const feeA = parseFloat((pos.fees?.tokenA || '0').replace(/[^0-9.]/g, ''));
      const feeB = parseFloat((pos.fees?.tokenB || '0').replace(/[^0-9.]/g, ''));
      const feesUsd = feeA * tokenAPrice + feeB * tokenBPrice;
      orcaFeesUsd += feesUsd;

      if (pos.inRange) orcaInRange++;

      orcaPositionList.push({
        pool: pos.poolName || 'Unknown',
        poolAddress: pos.poolAddress || '',
        dex: 'orca',
        valueUsd,
        feesUsd,
        inRange: pos.inRange || false,
      });
    }

    // Calculate Raydium values with proper token prices
    let raydiumValueUsd = 0;
    let raydiumFeesUsd = 0;
    let raydiumInRange = 0;
    const raydiumPositionList: PortfolioResponse['positions'] = [];

    for (const pos of raydiumPositions) {
      const tokenAPrice = priceCache.get(pos.tokenA?.mint) || 0;
      const tokenBPrice = priceCache.get(pos.tokenB?.mint) || 0;
      
      const valueUsd = pos.amountA * tokenAPrice + pos.amountB * tokenBPrice;
      raydiumValueUsd += valueUsd;

      const feesUsd = pos.feesOwedA * tokenAPrice + pos.feesOwedB * tokenBPrice;
      raydiumFeesUsd += feesUsd;

      if (pos.inRange) raydiumInRange++;

      raydiumPositionList.push({
        pool: pos.poolName || 'Unknown',
        poolAddress: pos.poolAddress || '',
        dex: 'raydium',
        valueUsd,
        feesUsd,
        inRange: pos.inRange || false,
      });
    }

    const totalValueUsd = meteoraValueUsd + orcaValueUsd + raydiumValueUsd;
    const totalFeesUsd = meteoraFeesUsd + orcaFeesUsd + raydiumFeesUsd;
    const inRangeCount = meteoraInRange + orcaInRange + raydiumInRange;
    const outOfRangeCount = totalPositions - inRangeCount;

    // Sort all positions by value descending
    const allPositions = [
      ...meteoraPositionList,
      ...orcaPositionList,
      ...raydiumPositionList,
    ].sort((a, b) => b.valueUsd - a.valueUsd);

    return c.json({
      success: true,
      walletAddress,
      solPrice,
      totalValueUsd,
      totalFeesUsd,
      positionCount: totalPositions,
      inRangeCount,
      outOfRangeCount,
      byDex: {
        meteora: { count: meteoraPositions.length, valueUsd: meteoraValueUsd, feesUsd: meteoraFeesUsd },
        orca: { count: orcaPositions.length, valueUsd: orcaValueUsd, feesUsd: orcaFeesUsd },
        raydium: { count: raydiumPositions.length, valueUsd: raydiumValueUsd, feesUsd: raydiumFeesUsd },
      },
      positions: allPositions,
    } as PortfolioResponse);

  } catch (error: any) {
    console.error('[Portfolio] Error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to fetch portfolio',
    }, 500);
  }
});

export default app;
