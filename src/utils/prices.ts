/**
 * Token Price Service
 * 
 * Uses Jupiter Price API to get current token prices in USD
 */

import { config } from '../config/index.js';

interface JupiterPriceResponse {
  data: Record<string, {
    id: string;
    type: string;
    price: string;
  }>;
  timeTaken: number;
}

// Cache prices for 30 seconds
let priceCache: Map<string, { price: number; timestamp: number }> = new Map();
const CACHE_TTL_MS = 30_000;

/**
 * Get current USD prices for multiple tokens
 * 
 * @param mints - Array of token mint addresses
 * @returns Map of mint -> USD price
 */
export async function getTokenPrices(mints: string[]): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  const now = Date.now();
  
  // Check cache first
  const uncachedMints: string[] = [];
  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      results.set(mint, cached.price);
    } else {
      uncachedMints.push(mint);
    }
  }
  
  // Fetch uncached prices
  if (uncachedMints.length > 0) {
    try {
      const ids = uncachedMints.join(',');
      const url = `https://api.jup.ag/price/v2?ids=${ids}`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      
      // Add API key if configured
      if (config.jupiter?.apiKey) {
        headers['x-api-key'] = config.jupiter.apiKey;
      }
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        console.warn(`[Prices] Jupiter API failed: ${response.status}`);
        // Set 0 for all uncached mints
        for (const mint of uncachedMints) {
          results.set(mint, 0);
        }
        return results;
      }
      
      const data = await response.json() as JupiterPriceResponse;
      
      // Extract prices
      for (const mint of uncachedMints) {
        const priceData = data.data[mint];
        const price = priceData ? parseFloat(priceData.price) : 0;
        results.set(mint, price);
        
        // Cache the price
        priceCache.set(mint, { price, timestamp: now });
      }
    } catch (error) {
      console.error('[Prices] Failed to fetch prices:', error);
      // Return 0 for failed fetches
      for (const mint of uncachedMints) {
        results.set(mint, 0);
      }
    }
  }
  
  return results;
}

/**
 * Get USD price for a single token
 */
export async function getTokenPrice(mint: string): Promise<number> {
  const prices = await getTokenPrices([mint]);
  return prices.get(mint) || 0;
}

/**
 * Convert token amount to USD value
 * 
 * @param mint - Token mint address
 * @param amount - Raw amount (in smallest units)
 * @param decimals - Token decimals
 * @returns USD value
 */
export async function tokenAmountToUsd(
  mint: string, 
  amount: bigint | number | string, 
  decimals: number
): Promise<number> {
  const price = await getTokenPrice(mint);
  const normalizedAmount = Number(amount) / Math.pow(10, decimals);
  return normalizedAmount * price;
}

/**
 * Clear price cache (for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}

export default {
  getTokenPrices,
  getTokenPrice,
  tokenAmountToUsd,
  clearPriceCache,
};
