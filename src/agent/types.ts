/**
 * Agent API Types
 */

import type { DEX } from '../gateway/types';

export interface LPIntent {
  action: 'scan' | 'open' | 'close' | 'add' | 'remove' | 'collect' | 'positions' | 'swap';
  dex?: DEX;
  pair?: string;
  amount?: number;
  amountA?: number;
  amountB?: number;
  positionId?: string;
  percentage?: number;
  strategy?: 'balanced' | 'concentrated' | 'wide';
  priceRange?: {
    lower: number;
    upper: number;
  };
  // Swap-specific fields
  inputToken?: string;
  outputToken?: string;
}

export interface AgentResponse {
  success: boolean;
  message: string;
  data?: unknown;
  transaction?: {
    unsigned: string;
    signed?: string;
    txid?: string;
  };
  error?: string;
}

export interface WalletState {
  address: string;
  balances: TokenBalance[];
  positions: PositionSummary[];
}

export interface TokenBalance {
  token: string;
  symbol: string;
  amount: number;
  usdValue?: number;
}

export interface PositionSummary {
  id: string;
  dex: DEX;
  pair: string;
  value: number;
  unclaimedFees: number;
  inRange: boolean;
}

export interface PoolOpportunity {
  dex: DEX;
  pool: string;
  pair: string;
  apy: number;
  tvl: number;
  volume24h: number;
  fee: number;
}
