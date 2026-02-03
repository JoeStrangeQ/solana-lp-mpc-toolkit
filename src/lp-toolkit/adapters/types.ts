/**
 * Unified LP Toolkit Types
 * Common interfaces across all DEX adapters
 */

import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";

// ============ Common Types ============

export type DEXVenue =
  | "meteora" // DLMM concentrated liquidity
  | "meteora-damm" // DAMM v2 full range
  | "orca" // Whirlpool concentrated
  | "raydium" // CLMM concentrated
  | "lifinity" // Oracle-based, reduced IL
  | "saber" // Stable swaps
  | "crema" // CLMM concentrated
  | "fluxbeam" // CLMM
  | "invariant" // CLMM with custom ticks
  | "phoenix"; // CLOB (not implemented)

export interface LPPool {
  venue: DEXVenue;
  address: string;
  name: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  fee: number; // Fee in percentage
  tvl: number; // Total value locked in USD
  apy: number; // Current APY (24h)
  apy7d: number; // 7-day average APY
  volume24h: number; // 24h volume in USD
  priceRange?: {
    // For concentrated liquidity
    lower: number;
    upper: number;
    current: number;
  };
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

export interface LPPosition {
  venue: DEXVenue;
  positionId: string;
  poolAddress: string;
  poolName: string;
  owner: string;
  tokenAAmount: string;
  tokenBAmount: string;
  valueUSD: number;
  unclaimedFees: {
    tokenA: string;
    tokenB: string;
    totalUSD: number;
  };
  priceRange?: {
    lower: number;
    upper: number;
  };
  inRange: boolean;
  createdAt?: number;
}

// ============ Operation Params ============

export interface AddLiquidityIntent {
  venue?: DEXVenue; // Optional - let toolkit choose best
  poolAddress?: string; // Optional - let toolkit find best pool
  tokenA: string; // Token symbol or mint
  tokenB: string; // Token symbol or mint
  amountA?: number; // Amount of token A
  amountB?: number; // Amount of token B
  totalValueUSD?: number; // Or just specify total value
  strategy?: LPStrategy;
  slippageBps?: number;
}

export interface RemoveLiquidityIntent {
  positionId: string;
  percentage?: number; // 0-100, default 100
  claimFees?: boolean; // Default true
}

export interface RebalanceIntent {
  positionId: string;
  newRange?: {
    lower: number;
    upper: number;
  };
  strategy?: LPStrategy;
}

// ============ Strategies ============

export type LPStrategy =
  | "balanced" // Equal split, wide range
  | "concentrated" // Tight range around current price
  | "bid-heavy" // More on buy side
  | "ask-heavy" // More on sell side
  | "delta-neutral" // Minimize IL
  | "yield-max"; // Chase highest yield, wider range

export interface StrategyConfig {
  strategy: LPStrategy;
  rangeWidth?: number; // Percentage from current price
  rebalanceThreshold?: number; // When to suggest rebalance
  maxSlippage?: number;
}

// ============ Results ============

export interface LPOperationResult {
  success: boolean;
  venue: DEXVenue;
  transactionId?: string;
  positionId?: string;
  error?: string;
  gasUsed?: number;
  feePaid?: {
    amount: number;
    token: string;
  };
}

export interface YieldScanResult {
  pools: LPPool[];
  recommended: LPPool | null;
  reasoning: string;
  timestamp: number;
}

// ============ Adapter Interface ============

export interface DEXAdapter {
  venue: DEXVenue;

  // Pool queries
  getPools(connection: Connection): Promise<LPPool[]>;
  getPool(connection: Connection, address: string): Promise<LPPool | null>;

  // Position queries
  getPositions(connection: Connection, user: PublicKey): Promise<LPPosition[]>;
  getPosition(
    connection: Connection,
    positionId: string,
  ): Promise<LPPosition | null>;

  // Operations
  addLiquidity(
    connection: Connection,
    user: Keypair,
    params: AddLiquidityIntent,
  ): Promise<{ transaction: Transaction; positionId: string }>;

  removeLiquidity(
    connection: Connection,
    user: Keypair,
    params: RemoveLiquidityIntent,
  ): Promise<Transaction>;

  claimFees(
    connection: Connection,
    user: Keypair,
    positionId: string,
  ): Promise<Transaction>;

  // Utilities
  estimateYield(pool: LPPool, amount: number, days: number): number;
  estimateIL(pool: LPPool, priceChange: number): number;
}

// ============ Chat Display ============

export interface ChatDisplayOptions {
  compact?: boolean;
  showLinks?: boolean;
  maxItems?: number;
}

export function formatPoolsForChat(
  pools: LPPool[],
  options?: ChatDisplayOptions,
): string {
  const { compact = false, maxItems = 5 } = options || {};

  const display = pools.slice(0, maxItems).map((pool, i) => {
    const apy = pool.apy ?? 0;
    const apy7d = pool.apy7d ?? apy;
    const fee = pool.fee ?? 0;
    
    if (compact) {
      return `${i + 1}. **${pool.name}** (${pool.venue}) - ${apy.toFixed(1)}% APY`;
    }
    return `
**${i + 1}. ${pool.name}** [${pool.venue}]
├ APY: ${apy.toFixed(1)}% (24h) / ${apy7d.toFixed(1)}% (7d)
├ TVL: $${formatNumber(pool.tvl ?? 0)}
├ Volume: $${formatNumber(pool.volume24h ?? 0)} (24h)
└ Fee: ${fee}%`;
  });

  return display.join("\n");
}

export function formatPositionsForChat(
  positions: LPPosition[],
  options?: ChatDisplayOptions,
): string {
  if (positions.length === 0) {
    return "📭 No active LP positions";
  }

  const { compact = false, maxItems = 10 } = options || {};

  const display = positions.slice(0, maxItems).map((pos, i) => {
    const rangeStatus = pos.inRange ? "🟢" : "🔴";

    if (compact) {
      return `${rangeStatus} **${pos.poolName}** - $${pos.valueUSD.toFixed(2)} (+$${pos.unclaimedFees.totalUSD.toFixed(2)} fees)`;
    }

    return `
${rangeStatus} **${pos.poolName}** [${pos.venue}]
├ Value: $${pos.valueUSD.toFixed(2)}
├ Unclaimed: $${pos.unclaimedFees.totalUSD.toFixed(2)}
├ Range: ${pos.priceRange ? `${pos.priceRange.lower.toFixed(4)} - ${pos.priceRange.upper.toFixed(4)}` : "Full range"}
└ ID: \`${pos.positionId.slice(0, 8)}...\``;
  });

  const totalValue = positions.reduce((sum, p) => sum + p.valueUSD, 0);
  const totalFees = positions.reduce(
    (sum, p) => sum + p.unclaimedFees.totalUSD,
    0,
  );

  return `📊 **Your LP Positions** (${positions.length} total)
💰 Total Value: $${totalValue.toFixed(2)}
🎁 Unclaimed Fees: $${totalFees.toFixed(2)}

${display.join("\n")}`;
}

function formatNumber(num: number | string | undefined | null): string {
  const n = typeof num === 'string' ? parseFloat(num) : (num ?? 0);
  if (isNaN(n)) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

export default {
  formatPoolsForChat,
  formatPositionsForChat,
};
