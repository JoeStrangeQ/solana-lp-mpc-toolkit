/**
 * Token Metadata Resolver
 * 
 * Resolves token mint addresses to human-readable symbols.
 * Uses Jupiter's verified token list for accuracy.
 */

// Well-known tokens (fallback)
const KNOWN_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL': { symbol: 'MET', name: 'Meteora', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk', decimals: 5 },
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': { symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', name: 'Raydium', decimals: 6 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade SOL', decimals: 9 },
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': { symbol: 'bSOL', name: 'BlazeStake SOL', decimals: 9 },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH', name: 'Wrapped Ether (Wormhole)', decimals: 8 },
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': { symbol: 'stSOL', name: 'Lido Staked SOL', decimals: 9 },
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { symbol: 'PYTH', name: 'Pyth Network', decimals: 6 },
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': { symbol: 'JTO', name: 'Jito', decimals: 9 },
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk': { symbol: 'WEN', name: 'Wen', decimals: 5 },
  'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC': { symbol: 'AI16Z', name: 'ai16z', decimals: 9 },
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof': { symbol: 'RENDER', name: 'Render', decimals: 8 },
  'DG2mjFePc5f5sMJ87qiH8SM5zYRNLN8afKBUpb6vTTaY': { symbol: 'SHARK', name: 'Shark', decimals: 6 },
  'PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx': { symbol: 'XAI', name: 'xAI Token', decimals: 9 },
};

// Cache for fetched metadata
let tokenListCache: Map<string, { symbol: string; name: string; decimals: number }> | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch Jupiter verified token list
 */
async function fetchJupiterTokenList(): Promise<Map<string, { symbol: string; name: string; decimals: number }>> {
  // Return cached if fresh
  if (tokenListCache && Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return tokenListCache;
  }

  try {
    // Jupiter's verified token list API
    const response = await fetch('https://token.jup.ag/strict');
    if (!response.ok) {
      throw new Error(`Jupiter API failed: ${response.status}`);
    }

    const tokens = await response.json() as Array<{
      address: string;
      symbol: string;
      name: string;
      decimals: number;
    }>;

    const map = new Map<string, { symbol: string; name: string; decimals: number }>();
    
    // Add known tokens first (as fallback)
    for (const [mint, data] of Object.entries(KNOWN_TOKENS)) {
      map.set(mint, data);
    }

    // Add Jupiter tokens (these override known tokens if present)
    for (const token of tokens) {
      map.set(token.address, {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
      });
    }

    tokenListCache = map;
    lastFetchTime = Date.now();
    console.log(`[TokenMetadata] Cached ${map.size} tokens from Jupiter`);
    return map;
  } catch (error) {
    console.warn('[TokenMetadata] Jupiter fetch failed, using known tokens:', error);
    
    // Return known tokens as fallback
    const map = new Map<string, { symbol: string; name: string; decimals: number }>();
    for (const [mint, data] of Object.entries(KNOWN_TOKENS)) {
      map.set(mint, data);
    }
    tokenListCache = map;
    lastFetchTime = Date.now();
    return map;
  }
}

/**
 * Resolve a single token mint to metadata
 */
export async function resolveToken(mint: string): Promise<{
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
}> {
  // Check known tokens first (instant)
  if (KNOWN_TOKENS[mint]) {
    return { mint, ...KNOWN_TOKENS[mint] };
  }

  // Fetch full list if needed
  const tokenList = await fetchJupiterTokenList();
  const metadata = tokenList.get(mint);

  if (metadata) {
    return { mint, ...metadata };
  }

  // Unknown token - return truncated address as symbol
  return {
    mint,
    symbol: mint.slice(0, 4) + '...' + mint.slice(-4),
    name: 'Unknown Token',
    decimals: 9, // Default assumption
  };
}

/**
 * Resolve multiple tokens at once (batched)
 */
export async function resolveTokens(mints: string[]): Promise<Map<string, {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
}>> {
  const tokenList = await fetchJupiterTokenList();
  const results = new Map<string, { mint: string; symbol: string; name: string; decimals: number }>();

  for (const mint of mints) {
    const metadata = tokenList.get(mint) || KNOWN_TOKENS[mint];
    if (metadata) {
      results.set(mint, { mint, ...metadata });
    } else {
      results.set(mint, {
        mint,
        symbol: mint.slice(0, 4) + '...' + mint.slice(-4),
        name: 'Unknown Token',
        decimals: 9,
      });
    }
  }

  return results;
}

/**
 * Get symbol for a mint (quick lookup)
 */
export function getSymbol(mint: string): string {
  return KNOWN_TOKENS[mint]?.symbol || mint.slice(0, 4) + '...' + mint.slice(-4);
}

/**
 * DEPRECATED: Use calculateHumanPriceRange instead.
 * This gives mathematical prices, not human-readable ones.
 * 
 * Convert bin ID to mathematical price
 * Formula: price = (1 + binStep/10000)^binId
 */
export function binIdToPrice(binId: number, binStep: number): number {
  const base = 1 + binStep / 10000;
  return Math.pow(base, binId);
}

/**
 * Calculate human-readable price from bin ID using active bin as anchor
 * 
 * The formula is:
 *   targetPrice = currentPrice * (1 + binStep/10000)^(targetBinId - activeBinId)
 * 
 * @param targetBinId - The bin ID to get price for
 * @param activeBinId - The active bin ID (from getActiveBin())
 * @param currentPrice - The current price (from getActiveBin().price)
 * @param binStep - The bin step in basis points
 * @returns Human-readable price
 */
export function binIdToHumanPrice(
  targetBinId: number,
  activeBinId: number,
  currentPrice: number,
  binStep: number
): number {
  const relativeBins = targetBinId - activeBinId;
  const base = 1 + binStep / 10000;
  return currentPrice * Math.pow(base, relativeBins);
}

/**
 * Convert price to bin ID (inverse of binIdToPrice)
 * 
 * @param price - The target price
 * @param binStep - The bin step in basis points
 * @returns The approximate bin ID
 */
export function priceToBinId(price: number, binStep: number): number {
  const base = 1 + binStep / 10000;
  return Math.round(Math.log(price) / Math.log(base));
}

/**
 * DEPRECATED: Use calculateHumanPriceRange instead.
 * This gives mathematical prices, not human-readable ones.
 */
export function calculatePriceRange(
  lowerBinId: number,
  upperBinId: number,
  binStep: number
): { priceLower: number; priceUpper: number } {
  return {
    priceLower: binIdToPrice(lowerBinId, binStep),
    priceUpper: binIdToPrice(upperBinId, binStep),
  };
}

/**
 * Calculate human-readable price range for a position
 * Uses the active bin's price as anchor for accurate conversion
 * 
 * @param lowerBinId - Lower bin ID of position
 * @param upperBinId - Upper bin ID of position
 * @param activeBinId - Active bin ID (from getActiveBin())
 * @param currentPrice - Current price (from getActiveBin().price as number)
 * @param binStep - Bin step in basis points
 * @returns Human-readable price range
 */
export function calculateHumanPriceRange(
  lowerBinId: number,
  upperBinId: number,
  activeBinId: number,
  currentPrice: number,
  binStep: number
): {
  priceLower: number;
  priceUpper: number;
  currentPrice: number;
  inRange: boolean;
} {
  const priceLower = binIdToHumanPrice(lowerBinId, activeBinId, currentPrice, binStep);
  const priceUpper = binIdToHumanPrice(upperBinId, activeBinId, currentPrice, binStep);
  const inRange = activeBinId >= lowerBinId && activeBinId <= upperBinId;
  
  return {
    priceLower,
    priceUpper,
    currentPrice,
    inRange,
  };
}

/**
 * Format price for human display
 * 
 * @param price - The price to format
 * @param decimals - Number of decimal places (default: 2 for most assets, 6 for micro-prices)
 */
export function formatPrice(price: number, decimals?: number): string {
  // Auto-detect decimals based on price magnitude
  if (decimals === undefined) {
    if (price >= 1) {
      decimals = 2;
    } else if (price >= 0.0001) {
      decimals = 6;
    } else {
      decimals = 10;
    }
  }
  return price.toFixed(decimals);
}

/**
 * Build human-readable price display string
 * 
 * @param priceLower - Lower price bound
 * @param priceUpper - Upper price bound
 * @param tokenYSymbol - Quote token symbol (e.g., "USDC")
 * @param tokenXSymbol - Base token symbol (e.g., "SOL")
 * @returns Human readable string like "195.50 - 205.00 USDC per SOL"
 */
export function formatPriceRange(
  priceLower: number,
  priceUpper: number,
  tokenYSymbol: string,
  tokenXSymbol: string
): string {
  return `${formatPrice(priceLower)} - ${formatPrice(priceUpper)} ${tokenYSymbol} per ${tokenXSymbol}`;
}

export default {
  resolveToken,
  resolveTokens,
  getSymbol,
  binIdToPrice,
  binIdToHumanPrice,
  priceToBinId,
  calculatePriceRange,
  calculateHumanPriceRange,
  formatPrice,
  formatPriceRange,
  KNOWN_TOKENS,
};
