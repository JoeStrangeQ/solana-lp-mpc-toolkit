/**
 * Raydium CLMM position discovery
 *
 * Discovers positions by using the Raydium SDK to fetch
 * owner's position NFTs across all CLMM pools.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
  Raydium,
  ClmmPoolPersonalPosition,
  ApiV3PoolInfoConcentratedItem,
  TickUtils,
} from '@raydium-io/raydium-sdk-v2';
import type { RaydiumPositionInfo } from './types.js';

// Raydium CLMM program ID
const CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

/**
 * Discover all Raydium CLMM positions for a wallet.
 *
 * Uses the Raydium SDK to find position NFTs and fetch position data.
 */
export async function discoverRaydiumPositions(
  connection: Connection,
  walletAddress: string,
): Promise<RaydiumPositionInfo[]> {
  try {
    const owner = new PublicKey(walletAddress);

    // Initialize Raydium SDK
    const raydium = await Raydium.load({
      connection,
      owner,
      cluster: 'mainnet',
      disableLoadToken: true,
      disableFeatureCheck: true,
    });

    // Get owner's position info using the SDK
    const positions = await raydium.clmm.getOwnerPositionInfo({
      programId: CLMM_PROGRAM_ID,
    });

    if (!positions.length) return [];

    // Get unique pool IDs from positions
    const poolIds = [...new Set(positions.map(p => p.poolId.toBase58()))];

    // Fetch pool info for all pools
    const poolInfoMap = await fetchPoolInfos(raydium, poolIds);

    const result: RaydiumPositionInfo[] = [];

    for (const pos of positions) {
      try {
        const poolId = pos.poolId.toBase58();
        const poolInfo = poolInfoMap[poolId];
        if (!poolInfo) continue;

        const currentTick = poolInfo.tickCurrent;
        const inRange = currentTick >= pos.tickLower && currentTick < pos.tickUpper;

        const decimalsA = poolInfo.mintA.decimals;
        const decimalsB = poolInfo.mintB.decimals;

        // Calculate prices using tick math
        const priceLower = TickUtils.getTickPrice({
          poolInfo: poolInfo as unknown as ApiV3PoolInfoConcentratedItem,
          tick: pos.tickLower,
          baseIn: true,
        }).price.toNumber();
        
        const priceUpper = TickUtils.getTickPrice({
          poolInfo: poolInfo as unknown as ApiV3PoolInfoConcentratedItem,
          tick: pos.tickUpper,
          baseIn: true,
        }).price.toNumber();
        
        const priceCurrent = TickUtils.getTickPrice({
          poolInfo: poolInfo as unknown as ApiV3PoolInfoConcentratedItem,
          tick: currentTick,
          baseIn: true,
        }).price.toNumber();

        result.push({
          address: pos.nftMint.toBase58(), // Use NFT mint as position address
          nftMint: pos.nftMint.toBase58(),
          poolAddress: poolId,
          poolName: `${poolInfo.mintA.symbol || poolInfo.mintA.address.slice(0, 6)}-${poolInfo.mintB.symbol || poolInfo.mintB.address.slice(0, 6)}`,
          tickLowerIndex: pos.tickLower,
          tickUpperIndex: pos.tickUpper,
          liquidity: pos.liquidity.toString(),
          tokenA: {
            amount: pos.amountA?.toString() || '0',
            symbol: poolInfo.mintA.symbol || poolInfo.mintA.address.slice(0, 6),
          },
          tokenB: {
            amount: pos.amountB?.toString() || '0',
            symbol: poolInfo.mintB.symbol || poolInfo.mintB.address.slice(0, 6),
          },
          fees: {
            tokenA: pos.tokenFeeAmountA?.toString() || '0',
            tokenB: pos.tokenFeeAmountB?.toString() || '0',
          },
          rewards: pos.rewardInfos?.map((r, i) => ({
            mint: poolInfo.rewardDefaultInfos?.[i]?.mint.address || 'unknown',
            amount: r.rewardAmountOwed?.toString() || '0',
          })) || [],
          inRange,
          priceLower,
          priceUpper,
          priceCurrent,
          dex: 'raydium',
        });
      } catch (err) {
        console.warn(`[Raydium] Failed to process position:`, err);
      }
    }

    return result;
  } catch (error) {
    console.error('[Raydium] Position discovery error:', error);
    return [];
  }
}

/**
 * Fetch pool info for multiple pools from the API
 */
async function fetchPoolInfos(
  raydium: Raydium,
  poolIds: string[],
): Promise<Record<string, ApiV3PoolInfoConcentratedItem>> {
  try {
    // Use Raydium API to fetch pool info
    const poolInfoList = await raydium.api.fetchPoolById({ ids: poolIds.join(',') });
    
    const result: Record<string, ApiV3PoolInfoConcentratedItem> = {};
    for (const pool of poolInfoList) {
      if (pool.type === 'Concentrated') {
        result[pool.id] = pool as ApiV3PoolInfoConcentratedItem;
      }
    }
    return result;
  } catch (error) {
    console.error('[Raydium] Failed to fetch pool infos:', error);
    return {};
  }
}

/**
 * Get position info for a specific position by NFT mint
 */
export async function getRaydiumPositionByMint(
  connection: Connection,
  walletAddress: string,
  nftMint: string,
): Promise<RaydiumPositionInfo | null> {
  const positions = await discoverRaydiumPositions(connection, walletAddress);
  return positions.find(p => p.nftMint === nftMint) || null;
}
