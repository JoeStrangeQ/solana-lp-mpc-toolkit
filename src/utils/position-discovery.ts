/**
 * Universal Position Discovery
 * 
 * Discovers ALL DLMM positions for a wallet across ANY pool.
 * No hardcoded pools - uses Meteora SDK's universal discovery.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { 
  resolveToken, 
  resolveTokens, 
  calculateHumanPriceRange, 
  formatPriceRange,
  formatPrice,
} from './token-metadata';
import { getCachedPoolInfo, getCachedDLMM } from '../services/pool-cache.js';

// Cache for Meteora pool names
const poolNameCache = new Map<string, string>();

/**
 * Fetch pool name from Meteora API
 */
async function getMeteoraPoolName(poolAddress: string): Promise<string | null> {
  // Check cache first
  if (poolNameCache.has(poolAddress)) {
    return poolNameCache.get(poolAddress)!;
  }
  
  try {
    const resp = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
    if (resp.ok) {
      const data = await resp.json() as { name?: string };
      const name = data.name || null;
      if (name) {
        poolNameCache.set(poolAddress, name);
      }
      return name;
    }
  } catch (e) {
    // Ignore fetch errors
  }
  return null;
}

export interface DiscoveredPosition {
  address: string;
  pool: {
    address: string;
    name: string;
    tokenX: {
      mint: string;
      symbol: string;
      name: string;
      decimals: number;
    };
    tokenY: {
      mint: string;
      symbol: string;
      name: string;
      decimals: number;
    };
    binStep: number;
  };
  binRange: {
    lower: number;
    upper: number;
  };
  priceRange: {
    priceLower: number;
    priceUpper: number;
    currentPrice: number;
    display: string;
    unit: string;
  };
  activeBinId: number;
  inRange: boolean;
  amounts: {
    tokenX: string;
    tokenY: string;
  };
  // LP trading fees earned (claimable)
  fees: {
    tokenX: string;       // Raw amount in smallest unit
    tokenY: string;       // Raw amount in smallest unit
    tokenXFormatted: string; // Human-readable with symbol
    tokenYFormatted: string; // Human-readable with symbol
  };
  solscanUrl: string;
}

/**
 * Discover ALL DLMM positions for a wallet
 * 
 * Uses Meteora SDK's getAllLbPairPositionsByUser() which scans
 * all DLMM pools on-chain. No hardcoded pool list needed.
 * 
 * @param connection - Solana RPC connection
 * @param walletAddress - Wallet to query positions for
 * @returns Array of discovered positions with human-readable prices
 */
export async function discoverAllPositions(
  connection: Connection,
  walletAddress: string
): Promise<DiscoveredPosition[]> {
  const userPubkey = new PublicKey(walletAddress);
  const allPositions: DiscoveredPosition[] = [];
  
  console.log(`[PositionDiscovery] Scanning ALL DLMM pools for wallet ${walletAddress}...`);
  
  try {
    // This is the magic - gets ALL positions across ALL pools
    const positionsMap = await DLMM.getAllLbPairPositionsByUser(connection, userPubkey);
    
    console.log(`[PositionDiscovery] Found positions in ${positionsMap.size} pools`);
    
    // Collect all token mints to resolve in batch
    const mintsToResolve = new Set<string>();
    
    for (const [poolAddress, positionInfo] of positionsMap) {
      const tokenXMint = positionInfo.tokenX.publicKey.toBase58();
      const tokenYMint = positionInfo.tokenY.publicKey.toBase58();
      mintsToResolve.add(tokenXMint);
      mintsToResolve.add(tokenYMint);
    }
    
    // Resolve all tokens in batch
    const tokenMetadata = await resolveTokens(Array.from(mintsToResolve));
    
    // Pre-load all pool instances in parallel (uses cache)
    const poolAddresses = Array.from(positionsMap.keys());
    console.log(`[PositionDiscovery] Loading ${poolAddresses.length} pools in parallel...`);
    
    const poolPromises = poolAddresses.map(addr => getCachedDLMM(connection, addr).catch(e => {
      console.warn(`[PositionDiscovery] Failed to load pool ${addr.slice(0, 8)}...: ${(e as Error).message}`);
      return null;
    }));
    const poolInstances = await Promise.all(poolPromises);
    const poolMap = new Map<string, any>();
    poolAddresses.forEach((addr, i) => {
      if (poolInstances[i]) poolMap.set(addr, poolInstances[i]);
    });
    
    // Get active bins for all pools in parallel
    const activeBinPromises = Array.from(poolMap.entries()).map(async ([addr, pool]) => {
      try {
        const activeBin = await pool.getActiveBin();
        return { addr, binStep: Number(pool.lbPair.binStep), activeBin };
      } catch (e) {
        console.warn(`[PositionDiscovery] Failed to get active bin for ${addr.slice(0, 8)}...`);
        return null;
      }
    });
    const activeBins = await Promise.all(activeBinPromises);
    const binDataMap = new Map<string, { binStep: number; activeBin: any }>();
    activeBins.filter(Boolean).forEach(data => {
      if (data) binDataMap.set(data.addr, { binStep: data.binStep, activeBin: data.activeBin });
    });
    
    // Process each pool's positions (now using pre-loaded data)
    for (const [poolAddress, positionInfo] of positionsMap) {
      try {
        // Get pre-loaded pool details
        const binData = binDataMap.get(poolAddress);
        if (!binData) continue;
        
        const { binStep, activeBin } = binData;
        // Use pricePerToken for human-readable price (accounts for token decimals)
        const currentPrice = Number(activeBin.pricePerToken);
        
        // Get token info
        const tokenXMint = positionInfo.tokenX.publicKey.toBase58();
        const tokenYMint = positionInfo.tokenY.publicKey.toBase58();
        const tokenX = tokenMetadata.get(tokenXMint)!;
        const tokenY = tokenMetadata.get(tokenYMint)!;
        
        // Process each position in this pool
        for (const lbPosition of positionInfo.lbPairPositionsData) {
          const posData = lbPosition.positionData;
          const lowerBinId = posData.lowerBinId;
          const upperBinId = posData.upperBinId;
          
          // Calculate human-readable prices
          const priceInfo = calculateHumanPriceRange(
            lowerBinId,
            upperBinId,
            activeBin.binId,
            currentPrice,
            binStep
          );
          
          const displayPrice = formatPriceRange(
            priceInfo.priceLower,
            priceInfo.priceUpper,
            tokenY.symbol,
            tokenX.symbol
          );
          
          // Extract claimable fees from position data
          const feeXRaw = posData.feeX?.toString() || '0';
          const feeYRaw = posData.feeY?.toString() || '0';
          
          // Format fees with decimals
          const feeXNum = Number(feeXRaw) / Math.pow(10, tokenX.decimals);
          const feeYNum = Number(feeYRaw) / Math.pow(10, tokenY.decimals);
          
          // Get pool name from Meteora API (falls back to token symbols)
          const meteoraPoolName = await getMeteoraPoolName(poolAddress);
          const poolName = meteoraPoolName || `${tokenX.symbol}-${tokenY.symbol}`;
          
          allPositions.push({
            address: lbPosition.publicKey.toBase58(),
            pool: {
              address: poolAddress,
              name: poolName,
              tokenX,
              tokenY,
              binStep,
            },
            binRange: {
              lower: lowerBinId,
              upper: upperBinId,
            },
            priceRange: {
              priceLower: priceInfo.priceLower,
              priceUpper: priceInfo.priceUpper,
              currentPrice: priceInfo.currentPrice,
              display: displayPrice,
              unit: `${tokenY.symbol} per ${tokenX.symbol}`,
            },
            activeBinId: activeBin.binId,
            inRange: priceInfo.inRange,
            amounts: {
              tokenX: posData.totalXAmount?.toString() || '0',
              tokenY: posData.totalYAmount?.toString() || '0',
            },
            fees: {
              tokenX: feeXRaw,
              tokenY: feeYRaw,
              tokenXFormatted: `${feeXNum.toFixed(6)} ${tokenX.symbol}`,
              tokenYFormatted: `${feeYNum.toFixed(6)} ${tokenY.symbol}`,
            },
            solscanUrl: `https://solscan.io/account/${lbPosition.publicKey.toBase58()}`,
          });
        }
      } catch (e) {
        console.warn(`[PositionDiscovery] Failed to process pool ${poolAddress}:`, (e as Error).message);
        // Continue with other pools
      }
    }
    
    console.log(`[PositionDiscovery] Discovered ${allPositions.length} total positions`);
    return allPositions;
    
  } catch (e) {
    console.error('[PositionDiscovery] Universal discovery failed:', (e as Error).message);
    throw e;
  }
}

/**
 * Get position details for a specific position address
 * 
 * @param connection - Solana RPC connection
 * @param walletAddress - Wallet that owns the position
 * @param positionAddress - The specific position to look up
 * @returns Position details or null if not found
 */
export async function getPositionDetails(
  connection: Connection,
  walletAddress: string,
  positionAddress: string
): Promise<DiscoveredPosition | null> {
  const positions = await discoverAllPositions(connection, walletAddress);
  return positions.find(p => p.address === positionAddress) || null;
}

/**
 * Get position's bin range from chain
 * Useful for monitoring when binRange wasn't provided
 * 
 * @param connection - Solana RPC connection
 * @param poolAddress - The pool address
 * @param positionAddress - The position to query
 * @param walletAddress - The wallet that owns the position
 * @returns Bin range { min, max } or null
 */
export async function getPositionBinRange(
  connection: Connection,
  poolAddress: string,
  positionAddress: string,
  walletAddress: string
): Promise<{ min: number; max: number } | null> {
  try {
    const pool = await DLMM.create(connection, new PublicKey(poolAddress));
    const userPubkey = new PublicKey(walletAddress);
    const positions = await pool.getPositionsByUserAndLbPair(userPubkey);
    
    const position = positions.userPositions.find(
      (p: any) => p.publicKey.toBase58() === positionAddress
    );
    
    if (position) {
      return {
        min: position.positionData.lowerBinId,
        max: position.positionData.upperBinId,
      };
    }
    
    return null;
  } catch (e) {
    console.warn(`[PositionDiscovery] Failed to get bin range:`, (e as Error).message);
    return null;
  }
}

/**
 * Get pool info including current active bin and price
 * 
 * @param connection - Solana RPC connection
 * @param poolAddress - The pool to query
 * @returns Pool info with current price
 */
export async function getPoolInfo(
  connection: Connection,
  poolAddress: string
): Promise<{
  address: string;
  name: string;
  tokenX: { mint: string; symbol: string };
  tokenY: { mint: string; symbol: string };
  binStep: number;
  activeBinId: number;
  currentPrice: number;
  displayPrice: string;
} | null> {
  try {
    // Use cached pool info (60s TTL)
    const cached = await getCachedPoolInfo(connection, poolAddress);
    
    return {
      address: poolAddress,
      name: `${cached.tokenX.symbol}-${cached.tokenY.symbol}`,
      tokenX: { mint: cached.tokenX.mint, symbol: cached.tokenX.symbol },
      tokenY: { mint: cached.tokenY.mint, symbol: cached.tokenY.symbol },
      binStep: cached.binStep,
      activeBinId: cached.activeBin,
      currentPrice: cached.activePrice,
      displayPrice: `${formatPrice(cached.activePrice)} ${cached.tokenY.symbol} per ${cached.tokenX.symbol}`,
    };
  } catch (e) {
    console.warn(`[PositionDiscovery] Failed to get pool info:`, (e as Error).message);
    return null;
  }
}

export default {
  discoverAllPositions,
  getPositionDetails,
  getPositionBinRange,
  getPoolInfo,
};
