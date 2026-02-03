/**
 * Hummingbot Gateway Types
 */

export type DEX = 'meteora' | 'orca' | 'raydium';
export type PoolType = 'clmm' | 'amm';

export interface PoolInfo {
  address: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  fee: number;
  liquidity: string;
  currentPrice: number;
  tickSpacing?: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

export interface Position {
  id: string;
  pool: string;
  dex: DEX;
  lowerPrice: number;
  upperPrice: number;
  liquidity: string;
  tokenAAmount: string;
  tokenBAmount: string;
  unclaimedFeesA: string;
  unclaimedFeesB: string;
  inRange: boolean;
}

export interface OpenPositionParams {
  dex: DEX;
  pool: string;
  lowerPrice: number;
  upperPrice: number;
  tokenAAmount: number;
  tokenBAmount: number;
  slippage?: number;
}

export interface OpenPositionResult {
  transaction: string; // Base64 unsigned TX
  positionAddress: string;
  estimatedFee: number;
}

export interface ClosePositionParams {
  dex: DEX;
  positionId: string;
  slippage?: number;
}

export interface AddLiquidityParams {
  dex: DEX;
  positionId: string;
  tokenAAmount: number;
  tokenBAmount: number;
  slippage?: number;
}

export interface RemoveLiquidityParams {
  dex: DEX;
  positionId: string;
  percentage: number; // 0-100
  slippage?: number;
}

export interface CollectFeesParams {
  dex: DEX;
  positionId: string;
}

export interface TransactionResult {
  transaction: string; // Base64 unsigned TX
  estimatedFee: number;
}

export interface GatewayError {
  error: string;
  code?: string;
}
