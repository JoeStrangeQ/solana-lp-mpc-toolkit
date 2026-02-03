/**
 * Types for external DEX APIs
 * Provides type safety for raw API responses
 */

export interface MeteoraApiPool {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  bin_step: number;
  base_fee_percentage: number;
  current_price: number;
  liquidity: number;
  apr: number;
  apr_7d: number;
  trade_volume_24h: number;
}

export interface OrcaApiWhirlpool {
  address: string;
  tvl: number;
  price: number;
  feeApr: number;
  lpFeeRate: number;
  tokenA: {
    symbol: string;
    mint: string;
    decimals: number;
  };
  tokenB: {
    symbol: string;
    mint: string;
    decimals: number;
  };
  volume: {
    day: number;
  };
}

export interface MeteoraApiPosition {
  address: string;
  pair_address: string;
  pair_name: string;
  total_value_usd: number;
  unclaimed_fee_usd: number;
  current_price?: number;
  price_lower?: number;
  price_upper?: number;
}
