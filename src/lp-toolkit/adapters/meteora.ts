/**
 * Meteora DLMM Adapter
 * Unified interface for Meteora DLMM liquidity operations
 */

import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';

// ============ Types ============

export interface MeteoraPool {
  address: string;
  name: string;
  mintX: string;
  mintY: string;
  binStep: number;
  baseFee: number;
  currentPrice: number;
  tvl: number;
  apy24h: number;
  apy7d: number;
  volume24h: number;
}

export interface MeteoraPosition {
  address: string;
  poolAddress: string;
  poolName: string;
  lowerBinId: number;
  upperBinId: number;
  liquidity: string;
  tokenXAmount: string;
  tokenYAmount: string;
  valueUSD: number;
  unclaimedFeesX: string;
  unclaimedFeesY: string;
  unclaimedFeesUSD: number;
}

export interface AddLiquidityParams {
  connection: Connection;
  user: Keypair;
  poolAddress: string;
  tokenXAmount: number;
  tokenYAmount: number;
  binRange?: number; // Number of bins to spread liquidity (default: 10)
  slippageBps?: number; // Slippage tolerance in bps (default: 50)
}

export interface RemoveLiquidityParams {
  connection: Connection;
  user: Keypair;
  positionAddress: string;
  percentage?: number; // 0-100, default 100 (full withdrawal)
}

// ============ Constants ============

export const POPULAR_POOLS = {
  'SOL-USDC': 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq',
  'SOL-USDT': '6WfCBxPWDrHMBVr5DyRTQr7w1FqTwW5EGMHynPCKxRxJ',
  'JUP-USDC': 'Gad6LaPqJMQwjF2sHctPdHm8qVqDsLLMz2pjCrUFp6Zb',
  'JUP-SOL': '5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq',
  'BONK-SOL': 'AQJcx5P8BVWwRqT6xCfMEbUqJWyXH7r3EyMKvwNzFKui',
} as const;

// ============ Core Functions ============

/**
 * Get all DLMM pools with yield data
 */
export async function getPools(connection: Connection): Promise<MeteoraPool[]> {
  try {
    // Fetch from Meteora API for pool data with APY
    const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
    const data = await response.json();
    
    return data.map((pool: any) => ({
      address: pool.address,
      name: pool.name,
      mintX: pool.mint_x,
      mintY: pool.mint_y,
      binStep: pool.bin_step,
      baseFee: pool.base_fee_percentage,
      currentPrice: pool.current_price,
      tvl: pool.liquidity || 0,
      apy24h: pool.apr || 0,
      apy7d: pool.apr_7d || pool.apr || 0,
      volume24h: pool.trade_volume_24h || 0,
    }));
  } catch (error) {
    console.error('Failed to fetch Meteora pools:', error);
    return [];
  }
}

/**
 * Get top pools by APY for a given token pair
 */
export async function getTopPools(
  connection: Connection,
  tokenA?: string,
  tokenB?: string,
  limit: number = 10
): Promise<MeteoraPool[]> {
  const pools = await getPools(connection);
  
  let filtered = pools;
  
  // Filter by token if specified
  if (tokenA) {
    const tokenAUpper = tokenA.toUpperCase();
    filtered = filtered.filter(p => 
      p.name.toUpperCase().includes(tokenAUpper)
    );
  }
  
  if (tokenB) {
    const tokenBUpper = tokenB.toUpperCase();
    filtered = filtered.filter(p => 
      p.name.toUpperCase().includes(tokenBUpper)
    );
  }
  
  // Sort by APY descending
  filtered.sort((a, b) => b.apy24h - a.apy24h);
  
  return filtered.slice(0, limit);
}

/**
 * Get user's positions across all Meteora DLMM pools
 */
export async function getPositions(
  connection: Connection,
  userPubkey: PublicKey
): Promise<MeteoraPosition[]> {
  try {
    // Fetch user positions from Meteora API
    const response = await fetch(
      `https://dlmm-api.meteora.ag/position/${userPubkey.toString()}`
    );
    const data = await response.json();
    
    if (!Array.isArray(data)) return [];
    
    return data.map((pos: any) => ({
      address: pos.address,
      poolAddress: pos.pair_address,
      poolName: pos.pair_name || 'Unknown',
      lowerBinId: pos.lower_bin_id,
      upperBinId: pos.upper_bin_id,
      liquidity: pos.total_liquidity || '0',
      tokenXAmount: pos.total_x_amount || '0',
      tokenYAmount: pos.total_y_amount || '0',
      valueUSD: pos.total_value_usd || 0,
      unclaimedFeesX: pos.unclaimed_fee_x || '0',
      unclaimedFeesY: pos.unclaimed_fee_y || '0',
      unclaimedFeesUSD: pos.unclaimed_fee_usd || 0,
    }));
  } catch (error) {
    console.error('Failed to fetch Meteora positions:', error);
    return [];
  }
}

/**
 * Add liquidity to a Meteora DLMM pool
 */
export async function addLiquidity(params: AddLiquidityParams): Promise<{
  transaction: Transaction;
  positionAddress: PublicKey;
}> {
  const { 
    connection, 
    user, 
    poolAddress, 
    tokenXAmount, 
    tokenYAmount,
    binRange = 10,
    slippageBps = 50 
  } = params;
  
  // Initialize DLMM instance
  const dlmm = await DLMM.create(connection, new PublicKey(poolAddress));
  
  // Get active bin for position centering
  const activeBin = await dlmm.getActiveBin();
  const activeBinId = activeBin.binId;
  
  // Calculate bin range around active price
  const lowerBinId = activeBinId - Math.floor(binRange / 2);
  const upperBinId = activeBinId + Math.ceil(binRange / 2);
  
  // Create position with balanced distribution
  const newPosition = Keypair.generate();
  
  // Build add liquidity transaction
  const addLiquidityTx = await dlmm.addLiquidityByStrategy({
    connection,
    positionPubKey: newPosition.publicKey,
    user: user.publicKey,
    totalXAmount: new BN(tokenXAmount),
    totalYAmount: new BN(tokenYAmount),
    strategy: {
      strategyType: 'SpotBalanced',
      minBinId: lowerBinId,
      maxBinId: upperBinId,
    },
    slippage: slippageBps / 10000, // Convert bps to decimal
  });
  
  // Sign with new position keypair
  addLiquidityTx.sign(newPosition);
  
  return {
    transaction: addLiquidityTx,
    positionAddress: newPosition.publicKey,
  };
}

/**
 * Remove liquidity from a Meteora DLMM position
 */
export async function removeLiquidity(params: RemoveLiquidityParams): Promise<Transaction> {
  const { connection, user, positionAddress, percentage = 100 } = params;
  
  // Get position info to find the pool
  const positionPubkey = new PublicKey(positionAddress);
  
  // Fetch position to get pool address
  const response = await fetch(
    `https://dlmm-api.meteora.ag/position_v2/${positionAddress}`
  );
  const positionData = await response.json();
  
  if (!positionData.pair_address) {
    throw new Error('Could not find pool for position');
  }
  
  // Initialize DLMM instance
  const dlmm = await DLMM.create(connection, new PublicKey(positionData.pair_address));
  
  // Get the position's bin IDs
  const { userPositions } = await dlmm.getPositionsByUserAndLbPair(user.publicKey);
  const position = userPositions.find(p => p.publicKey.equals(positionPubkey));
  
  if (!position) {
    throw new Error('Position not found');
  }
  
  // Build remove liquidity transaction
  const binIdsToRemove = position.positionData.positionBinData.map(bin => bin.binId);
  const bpsToRemove = Math.floor(percentage * 100); // Convert percentage to bps
  
  const removeLiquidityTx = await dlmm.removeLiquidity({
    user: user.publicKey,
    position: positionPubkey,
    binIds: binIdsToRemove,
    bps: new BN(bpsToRemove),
    shouldClaimAndClose: percentage === 100,
  });
  
  return removeLiquidityTx;
}

/**
 * Claim fees from a position
 */
export async function claimFees(
  connection: Connection,
  user: Keypair,
  positionAddress: string
): Promise<Transaction> {
  const positionPubkey = new PublicKey(positionAddress);
  
  // Fetch position to get pool address
  const response = await fetch(
    `https://dlmm-api.meteora.ag/position_v2/${positionAddress}`
  );
  const positionData = await response.json();
  
  if (!positionData.pair_address) {
    throw new Error('Could not find pool for position');
  }
  
  const dlmm = await DLMM.create(connection, new PublicKey(positionData.pair_address));
  
  const claimTx = await dlmm.claimAllRewards({
    owner: user.publicKey,
    positions: [positionPubkey],
  });
  
  return claimTx;
}

// ============ Utility Functions ============

/**
 * Format position for display in chat
 */
export function formatPositionForChat(position: MeteoraPosition): string {
  return `📊 **${position.poolName}**
├ Value: $${position.valueUSD.toFixed(2)}
├ Range: Bin ${position.lowerBinId} → ${position.upperBinId}
├ Unclaimed: $${position.unclaimedFeesUSD.toFixed(2)}
└ ID: \`${position.address.slice(0, 8)}...\``;
}

/**
 * Format pool for display in chat
 */
export function formatPoolForChat(pool: MeteoraPool): string {
  return `🏊 **${pool.name}**
├ APY: ${pool.apy24h.toFixed(1)}% (24h) / ${pool.apy7d.toFixed(1)}% (7d)
├ TVL: $${(pool.tvl / 1e6).toFixed(2)}M
├ Volume: $${(pool.volume24h / 1e6).toFixed(2)}M (24h)
└ Fee: ${pool.baseFee}%`;
}

export default {
  getPools,
  getTopPools,
  getPositions,
  addLiquidity,
  removeLiquidity,
  claimFees,
  formatPositionForChat,
  formatPoolForChat,
  POPULAR_POOLS,
};
