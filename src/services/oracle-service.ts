/**
 * Multi-Oracle Price Aggregation Service
 *
 * Queries Pyth (via Hermes REST API) and Jupiter in parallel,
 * returns median prices with confidence data, and flags divergences.
 */

import { config } from '../config/index.js';
import { getPythFeedId } from '../utils/pyth-feeds.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OraclePrice {
  price: number;
  confidence: number;       // Pyth confidence interval (0 if unavailable)
  emaPrice: number;          // Exponential moving average (same as price if unavailable)
  source: 'pyth' | 'jupiter';
  timestamp: number;         // Unix ms
  stale: boolean;            // true if older than MAX_STALENESS_MS
}

export interface AggregatedPrice {
  price: number;             // Median of all sources
  emaPrice: number;          // Best available EMA
  confidence: number;        // Widest confidence interval
  sources: OraclePrice[];
  divergence: number;        // Max % difference between sources
  reliable: boolean;         // false if divergence > 0.5% or all stale
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STALENESS_MS = 30_000;
const CACHE_TTL_MS = 10_000;
const DIVERGENCE_THRESHOLD = 0.005; // 0.5%
const HERMES_BASE = 'https://hermes.pyth.network';
const FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, { result: AggregatedPrice; timestamp: number }>();

// ---------------------------------------------------------------------------
// Pyth Hermes helpers
// ---------------------------------------------------------------------------

interface HermesParsedPrice {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}

interface HermesParsedData {
  id: string;
  price: HermesParsedPrice;
  ema_price: HermesParsedPrice;
}

interface HermesResponse {
  parsed: HermesParsedData[];
}

function pythParsedToNumber(p: HermesParsedPrice): number {
  return Number(p.price) * Math.pow(10, p.expo);
}

function pythConfToNumber(p: HermesParsedPrice): number {
  return Number(p.conf) * Math.pow(10, p.expo);
}

async function fetchPythPrice(mint: string): Promise<OraclePrice | null> {
  const feedId = getPythFeedId(mint);
  if (!feedId) return null;

  try {
    const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${feedId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.warn(`[Oracle] Pyth Hermes returned ${resp.status} for ${mint.slice(0, 8)}...`);
      return null;
    }

    const data = (await resp.json()) as HermesResponse;
    const parsed = data.parsed?.[0];
    if (!parsed) return null;

    const price = pythParsedToNumber(parsed.price);
    const confidence = pythConfToNumber(parsed.price);
    const emaPrice = pythParsedToNumber(parsed.ema_price);
    const publishTimeMs = parsed.price.publish_time * 1000;

    return {
      price,
      confidence,
      emaPrice,
      source: 'pyth',
      timestamp: publishTimeMs,
      stale: Date.now() - publishTimeMs > MAX_STALENESS_MS,
    };
  } catch (err) {
    console.warn(`[Oracle] Pyth fetch failed for ${mint.slice(0, 8)}...:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jupiter helper
// ---------------------------------------------------------------------------

async function fetchJupiterPrice(mint: string): Promise<OraclePrice | null> {
  try {
    const url = `https://api.jup.ag/price/v2?ids=${mint}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.jupiter?.apiKey) {
      headers['x-api-key'] = config.jupiter.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.warn(`[Oracle] Jupiter returned ${resp.status} for ${mint.slice(0, 8)}...`);
      return null;
    }

    const body = (await resp.json()) as {
      data: Record<string, { id: string; price: string }>;
    };
    const entry = body.data?.[mint];
    if (!entry) return null;

    const price = parseFloat(entry.price);
    if (!price || !isFinite(price)) return null;

    const now = Date.now();
    return {
      price,
      confidence: 0,
      emaPrice: price,
      source: 'jupiter',
      timestamp: now,
      stale: false,
    };
  } catch (err) {
    console.warn(`[Oracle] Jupiter fetch failed for ${mint.slice(0, 8)}...:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregate(sources: OraclePrice[]): AggregatedPrice {
  if (sources.length === 0) {
    return {
      price: 0,
      emaPrice: 0,
      confidence: 0,
      sources: [],
      divergence: 0,
      reliable: false,
    };
  }

  const prices = sources.map((s) => s.price);
  const medianPrice = median(prices);

  // Best EMA: prefer Pyth (it provides a true EMA)
  const pythSource = sources.find((s) => s.source === 'pyth');
  const emaPrice = pythSource ? pythSource.emaPrice : medianPrice;

  // Widest confidence
  const confidence = Math.max(...sources.map((s) => s.confidence));

  // Divergence: max pairwise % difference
  let maxDiv = 0;
  for (let i = 0; i < prices.length; i++) {
    for (let j = i + 1; j < prices.length; j++) {
      const avg = (prices[i] + prices[j]) / 2;
      if (avg > 0) {
        const div = Math.abs(prices[i] - prices[j]) / avg;
        if (div > maxDiv) maxDiv = div;
      }
    }
  }

  const allStale = sources.every((s) => s.stale);
  const reliable = !allStale && maxDiv <= DIVERGENCE_THRESHOLD;

  if (maxDiv > DIVERGENCE_THRESHOLD) {
    console.warn(
      `[Oracle] Price divergence ${(maxDiv * 100).toFixed(2)}% detected — sources: ${sources.map((s) => `${s.source}=$${s.price}`).join(', ')}`,
    );
  }

  return {
    price: medianPrice,
    emaPrice,
    confidence,
    sources,
    divergence: maxDiv,
    reliable,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get an aggregated price for a single token mint (USD).
 * Queries Pyth and Jupiter in parallel, caches for 10 s.
 */
export async function getAggregatedPrice(mint: string): Promise<AggregatedPrice> {
  const now = Date.now();
  const cached = cache.get(mint);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const [pyth, jupiter] = await Promise.all([
    fetchPythPrice(mint),
    fetchJupiterPrice(mint),
  ]);

  const sources: OraclePrice[] = [];
  if (pyth) sources.push(pyth);
  if (jupiter) sources.push(jupiter);

  const result = aggregate(sources);
  cache.set(mint, { result, timestamp: now });
  return result;
}

/**
 * Get aggregated prices for multiple token mints (USD).
 */
export async function getAggregatedPrices(
  mints: string[],
): Promise<Map<string, AggregatedPrice>> {
  const results = new Map<string, AggregatedPrice>();
  const uncached: string[] = [];
  const now = Date.now();

  for (const mint of mints) {
    const cached = cache.get(mint);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      results.set(mint, cached.result);
    } else {
      uncached.push(mint);
    }
  }

  if (uncached.length > 0) {
    const promises = uncached.map(async (mint) => {
      const agg = await getAggregatedPrice(mint);
      results.set(mint, agg);
    });
    await Promise.all(promises);
  }

  return results;
}

/**
 * Clear the oracle cache (for testing).
 */
export function clearOracleCache(): void {
  cache.clear();
}
