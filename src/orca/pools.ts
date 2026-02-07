/**
 * Orca pool discovery via REST API
 */

import type { OrcaPoolInfo } from './types.js';

const ORCA_API = 'https://api.orca.so/v2/solana';

let _poolCache: { data: OrcaPoolInfo[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

// Tick spacing to fee rate mapping (bps)
const TICK_SPACING_FEE: Record<number, number> = {
  1: 1, 2: 2, 4: 5, 8: 10, 16: 15, 32: 30, 64: 65, 128: 100, 256: 200,
};

export async function fetchOrcaPools(limit = 20, sortBy = 'tvl'): Promise<OrcaPoolInfo[]> {
  if (_poolCache && Date.now() - _poolCache.fetchedAt < CACHE_TTL_MS) {
    return _poolCache.data.slice(0, limit);
  }

  const url = `${ORCA_API}/pools?sortBy=${sortBy}&sortDirection=desc&size=${Math.min(limit * 2, 50)}&minTvl=50000`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Orca API failed: ${resp.status}`);

  const data = (await resp.json()) as any;
  const pools: OrcaPoolInfo[] = (data.data || []).map((p: any) => ({
    address: p.address,
    name: `${p.tokenA?.symbol || '?'}-${p.tokenB?.symbol || '?'}`,
    tokenA: { mint: p.tokenA?.mint || '', symbol: p.tokenA?.symbol || '?', decimals: p.tokenA?.decimals || 9 },
    tokenB: { mint: p.tokenB?.mint || '', symbol: p.tokenB?.symbol || '?', decimals: p.tokenB?.decimals || 6 },
    tickSpacing: p.tickSpacing || 64,
    feeRate: TICK_SPACING_FEE[p.tickSpacing] || 65,
    tvl: p.tvl || 0,
    volume24h: p.stats?.volume24h || p.volume?.day || 0,
    price: p.price || 0,
  }));

  _poolCache = { data: pools, fetchedAt: Date.now() };
  return pools.slice(0, limit);
}

export async function fetchOrcaPoolByAddress(address: string): Promise<OrcaPoolInfo | null> {
  // Try cache first
  if (_poolCache) {
    const cached = _poolCache.data.find(p => p.address === address);
    if (cached) return cached;
  }

  try {
    const resp = await fetch(`${ORCA_API}/pools/${address}`);
    if (!resp.ok) return null;
    const p = (await resp.json()) as any;
    return {
      address: p.address,
      name: `${p.tokenA?.symbol || '?'}-${p.tokenB?.symbol || '?'}`,
      tokenA: { mint: p.tokenA?.mint || '', symbol: p.tokenA?.symbol || '?', decimals: p.tokenA?.decimals || 9 },
      tokenB: { mint: p.tokenB?.mint || '', symbol: p.tokenB?.symbol || '?', decimals: p.tokenB?.decimals || 6 },
      tickSpacing: p.tickSpacing || 64,
      feeRate: TICK_SPACING_FEE[p.tickSpacing] || 65,
      tvl: p.tvl || 0,
      volume24h: p.stats?.volume24h || p.volume?.day || 0,
      price: p.price || 0,
    };
  } catch {
    return null;
  }
}
