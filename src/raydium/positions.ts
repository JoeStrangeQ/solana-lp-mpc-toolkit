/**
 * Raydium CLMM Position Discovery
 * 
 * Fetches and formats user's Raydium CLMM positions.
 */

import { PublicKey } from '@solana/web3.js';
import { getRaydiumClient, RAYDIUM_CLMM_PROGRAM_ID } from './client.js';
import { ApiV3PoolInfoConcentratedItem } from '@raydium-io/raydium-sdk-v2';

export interface RaydiumPosition {
  positionAddress: string;
  positionMint: string; // NFT mint
  poolAddress: string;
  poolName: string;
  tokenA: { symbol: string; mint: string };
  tokenB: { symbol: string; mint: string };
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
  currentPrice: number;
  inRange: boolean;
  feesOwedA: number;
  feesOwedB: number;
  amountA: number;
  amountB: number;
}

/**
 * Fetch all Raydium CLMM positions for a wallet
 */
export async function fetchRaydiumPositions(walletAddress: string): Promise<RaydiumPosition[]> {
  try {
    const raydium = await getRaydiumClient();
    
    // Fetch all CLMM positions owned by wallet
    const positions = await raydium.clmm.getOwnerPositionInfo({
      programId: RAYDIUM_CLMM_PROGRAM_ID,
    });
    
    if (!positions || positions.length === 0) {
      return [];
    }
    
    const result: RaydiumPosition[] = [];
    
    for (const pos of positions) {
      try {
        // Get pool info for this position
        const poolData = await raydium.api.fetchPoolById({ ids: pos.poolId.toBase58() });
        const poolInfo = poolData[0] as ApiV3PoolInfoConcentratedItem;
        
        if (!poolInfo) continue;
        
        const currentPrice = poolInfo.price || 0;
        const priceLower = tickToPrice(pos.tickLower, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
        const priceUpper = tickToPrice(pos.tickUpper, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
        
        result.push({
          positionAddress: pos.nftMint.toBase58(),
          positionMint: pos.nftMint.toBase58(),
          poolAddress: pos.poolId.toBase58(),
          poolName: `${poolInfo.mintA.symbol}-${poolInfo.mintB.symbol}`,
          tokenA: {
            symbol: poolInfo.mintA.symbol || 'UNKNOWN',
            mint: poolInfo.mintA.address,
          },
          tokenB: {
            symbol: poolInfo.mintB.symbol || 'UNKNOWN',
            mint: poolInfo.mintB.address,
          },
          liquidity: pos.liquidity.toString(),
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          priceLower,
          priceUpper,
          currentPrice,
          inRange: currentPrice >= priceLower && currentPrice <= priceUpper,
          feesOwedA: 0, // TODO: Calculate from rewards
          feesOwedB: 0,
          amountA: 0, // TODO: Calculate from liquidity
          amountB: 0,
        });
      } catch (err) {
        console.error(`[Raydium] Error processing position ${pos.nftMint.toBase58()}:`, err);
      }
    }
    
    return result;
  } catch (error) {
    console.error('[Raydium] Error fetching positions:', error);
    return [];
  }
}

/**
 * Convert tick to price
 */
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  // Raydium uses same tick math as Orca
  // price = 1.0001^tick * 10^(decimalsA - decimalsB)
  const decimalAdjustment = Math.pow(10, decimalsA - decimalsB);
  return Math.pow(1.0001, tick) * decimalAdjustment;
}

/**
 * Fetch single position details by NFT mint
 */
export async function fetchRaydiumPosition(
  positionMint: string,
): Promise<RaydiumPosition | null> {
  try {
    const raydium = await getRaydiumClient();
    
    // Get all positions and find the one with matching NFT mint
    const positions = await raydium.clmm.getOwnerPositionInfo({});
    const positionData = positions.find(p => p.nftMint.toBase58() === positionMint);
    
    if (!positionData) return null;
    
    // Get pool info
    const poolData = await raydium.api.fetchPoolById({ ids: positionData.poolId.toBase58() });
    const poolInfo = poolData[0] as ApiV3PoolInfoConcentratedItem;
    
    if (!poolInfo) return null;
    
    const currentPrice = poolInfo.price || 0;
    const priceLower = tickToPrice(positionData.tickLower, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
    const priceUpper = tickToPrice(positionData.tickUpper, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
    
    return {
      positionAddress: positionMint,
      positionMint,
      poolAddress: positionData.poolId.toBase58(),
      poolName: `${poolInfo.mintA.symbol}-${poolInfo.mintB.symbol}`,
      tokenA: {
        symbol: poolInfo.mintA.symbol || 'UNKNOWN',
        mint: poolInfo.mintA.address,
      },
      tokenB: {
        symbol: poolInfo.mintB.symbol || 'UNKNOWN',
        mint: poolInfo.mintB.address,
      },
      liquidity: positionData.liquidity.toString(),
      tickLower: positionData.tickLower,
      tickUpper: positionData.tickUpper,
      priceLower,
      priceUpper,
      currentPrice,
      inRange: currentPrice >= priceLower && currentPrice <= priceUpper,
      feesOwedA: 0,
      feesOwedB: 0,
      amountA: 0,
      amountB: 0,
    };
  } catch (error) {
    console.error('[Raydium] Error fetching position:', error);
    return null;
  }
}
