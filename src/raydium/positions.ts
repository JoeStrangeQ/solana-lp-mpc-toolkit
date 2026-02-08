/**
 * Raydium CLMM position discovery
 *
 * Discovers positions by using the Raydium SDK to fetch
 * owner's position NFTs across all CLMM pools.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Raydium } from '@raydium-io/raydium-sdk-v2';
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

    // Get owner's position layouts using the SDK
    const positionLayouts = await raydium.clmm.getOwnerPositionInfo({
      programId: CLMM_PROGRAM_ID,
    });

    if (!positionLayouts.length) return [];

    // Get unique pool IDs from positions
    const poolIds = [...new Set(positionLayouts.map(p => p.poolId.toBase58()))];

    // Fetch pool info for all pools from API
    const poolInfoMap = await fetchPoolInfos(raydium, poolIds);
    
    // Also fetch RPC data for current tick
    const poolRpcDataMap: Record<string, { tickCurrent: number }> = {};
    for (const poolId of poolIds) {
      try {
        const rpcData = await raydium.clmm.getRpcClmmPoolInfo({ poolId });
        poolRpcDataMap[poolId] = { tickCurrent: rpcData.tickCurrent };
      } catch (e) {
        console.warn(`[Raydium] Failed to get RPC data for pool ${poolId}`);
      }
    }

    const result: RaydiumPositionInfo[] = [];

    for (const pos of positionLayouts) {
      try {
        const poolId = pos.poolId.toBase58();
        const poolInfo = poolInfoMap[poolId];
        const poolRpcData = poolRpcDataMap[poolId];
        
        if (!poolInfo) continue;

        const currentTick = poolRpcData?.tickCurrent ?? 0;
        const inRange = currentTick >= pos.tickLower && currentTick < pos.tickUpper;

        const decimalsA = poolInfo.mintA.decimals;
        const decimalsB = poolInfo.mintB.decimals;

        // Calculate prices using tick math
        const priceLower = tickToPrice(pos.tickLower, decimalsA, decimalsB);
        const priceUpper = tickToPrice(pos.tickUpper, decimalsA, decimalsB);
        const priceCurrent = tickToPrice(currentTick, decimalsA, decimalsB);

        result.push({
          address: pos.nftMint.toBase58(), // Use NFT mint as position address
          nftMint: pos.nftMint.toBase58(),
          poolAddress: poolId,
          poolName: `${poolInfo.mintA.symbol || poolInfo.mintA.address.slice(0, 6)}-${poolInfo.mintB.symbol || poolInfo.mintB.address.slice(0, 6)}`,
          tickLowerIndex: pos.tickLower,
          tickUpperIndex: pos.tickUpper,
          liquidity: pos.liquidity.toString(),
          tokenA: {
            amount: '0', // Position layout doesn't have amounts directly
            symbol: poolInfo.mintA.symbol || poolInfo.mintA.address.slice(0, 6),
          },
          tokenB: {
            amount: '0',
            symbol: poolInfo.mintB.symbol || poolInfo.mintB.address.slice(0, 6),
          },
          fees: {
            tokenA: pos.tokenFeesOwedA?.toString() || '0',
            tokenB: pos.tokenFeesOwedB?.toString() || '0',
          },
          rewards: pos.rewardInfos?.map((r, i) => ({
            mint: poolInfo.rewardDefaultInfos?.[i]?.mint?.address || 'unknown',
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
 * Convert tick to price
 * Uses the formula: price = 1.0001^tick * 10^(decimalsA - decimalsB)
 */
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  try {
    // price = 1.0001^tick
    const price = Math.pow(1.0001, tick) * Math.pow(10, decimalsA - decimalsB);
    return price;
  } catch {
    return 0;
  }
}

/**
 * Fetch pool info for multiple pools from the API
 */
async function fetchPoolInfos(
  raydium: Raydium,
  poolIds: string[],
): Promise<Record<string, {
  mintA: { address: string; symbol: string; decimals: number };
  mintB: { address: string; symbol: string; decimals: number };
  rewardDefaultInfos?: Array<{ mint: { address: string } }>;
}>> {
  try {
    // Use Raydium API to fetch pool info
    const poolInfoList = await raydium.api.fetchPoolById({ ids: poolIds.join(',') });
    
    const result: Record<string, {
      mintA: { address: string; symbol: string; decimals: number };
      mintB: { address: string; symbol: string; decimals: number };
      rewardDefaultInfos?: Array<{ mint: { address: string } }>;
    }> = {};
    
    for (const pool of poolInfoList) {
      if (pool.type === 'Concentrated') {
        result[pool.id] = {
          mintA: {
            address: pool.mintA.address,
            symbol: pool.mintA.symbol,
            decimals: pool.mintA.decimals,
          },
          mintB: {
            address: pool.mintB.address,
            symbol: pool.mintB.symbol,
            decimals: pool.mintB.decimals,
          },
          rewardDefaultInfos: pool.rewardDefaultInfos,
        };
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
