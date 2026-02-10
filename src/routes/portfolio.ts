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

app.get('/:walletAddress', async (c) => {
  const walletAddress = c.req.param('walletAddress');
  stats.requests.total++;
  stats.requests.byEndpoint['/portfolio/:walletAddress'] = (stats.requests.byEndpoint['/portfolio/:walletAddress'] || 0) + 1;
  
  if (!walletAddress || walletAddress.length < 32) {
    return c.json({ success: false, error: 'Invalid wallet address' }, 400);
  }
  
  try {
    // Fetch SOL price for USD conversions
    let solPrice = 200; // Default fallback
    try {
      const priceResult = await getAggregatedPrice('So11111111111111111111111111111111111111112');
      solPrice = priceResult.price;
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

    // Calculate Meteora values
    let meteoraValueUsd = 0;
    let meteoraFeesUsd = 0;
    let meteoraInRange = 0;
    const meteoraPositionList: PortfolioResponse['positions'] = [];

    for (const pos of meteoraPositions) {
      const tokenXAmount = pos.amounts?.tokenX?.amount || 0;
      const tokenYAmount = pos.amounts?.tokenY?.amount || 0;
      
      // Rough USD calculation (assumes tokenX is SOL-like, tokenY is USD-like)
      const valueUsd = tokenXAmount * solPrice + tokenYAmount;
      meteoraValueUsd += valueUsd;

      // Parse fees
      const feeX = parseFloat((pos.fees?.tokenX || '0').toString().replace(/[^0-9.]/g, ''));
      const feeY = parseFloat((pos.fees?.tokenY || '0').toString().replace(/[^0-9.]/g, ''));
      const feesUsd = feeX * solPrice + feeY;
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

    // Calculate Orca values
    let orcaValueUsd = 0;
    let orcaFeesUsd = 0;
    let orcaInRange = 0;
    const orcaPositionList: PortfolioResponse['positions'] = [];

    for (const pos of orcaPositions) {
      const tokenAAmount = parseFloat(pos.tokenA?.amount || '0');
      const tokenBAmount = parseFloat(pos.tokenB?.amount || '0');
      
      const valueUsd = tokenAAmount * solPrice + tokenBAmount;
      orcaValueUsd += valueUsd;

      const feeA = parseFloat((pos.fees?.tokenA || '0').replace(/[^0-9.]/g, ''));
      const feeB = parseFloat((pos.fees?.tokenB || '0').replace(/[^0-9.]/g, ''));
      const feesUsd = feeA * solPrice + feeB;
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

    // Calculate Raydium values
    let raydiumValueUsd = 0;
    let raydiumFeesUsd = 0;
    let raydiumInRange = 0;
    const raydiumPositionList: PortfolioResponse['positions'] = [];

    for (const pos of raydiumPositions) {
      const valueUsd = pos.amountA * solPrice + pos.amountB;
      raydiumValueUsd += valueUsd;

      const feesUsd = pos.feesOwedA * solPrice + pos.feesOwedB;
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
