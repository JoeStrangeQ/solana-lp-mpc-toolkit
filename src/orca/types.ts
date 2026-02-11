/**
 * Orca Whirlpool CLMM type definitions
 */

export interface OrcaPoolInfo {
  address: string;
  name: string;
  tokenA: { mint: string; symbol: string; decimals: number };
  tokenB: { mint: string; symbol: string; decimals: number };
  tickSpacing: number;
  feeRate: number;
  tvl: number;
  volume24h: number;
  price: number;
}

export interface OrcaPositionInfo {
  address: string;
  mintAddress: string;
  poolAddress: string;
  poolName: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: string;
  tokenA: { mint: string; amount: string; symbol: string };
  tokenB: { mint: string; amount: string; symbol: string };
  fees: { tokenA: string; tokenB: string };
  inRange: boolean;
  priceLower: number;
  priceUpper: number;
  priceCurrent: number;
  dex: 'orca';
}
