/**
 * LP Strategy Templates
 * Pre-built strategies for common LP use cases
 *
 * Strategies:
 * - balanced: Equal split, moderate range (default)
 * - concentrated: Tight range, high capital efficiency
 * - yield-max: Wide range, prioritize fee capture
 * - delta-neutral: Minimize impermanent loss
 * - dca-accumulate: Gradually accumulate target token
 */

import { LPPool, LPStrategy, AddLiquidityIntent } from "../adapters/types";

// ============ Types ============

export interface StrategyTemplate {
  id: LPStrategy;
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high";

  // Range configuration
  rangeWidthPercent: number; // % from current price
  rangeSkew: number; // -1 to 1 (negative = more on buy side)

  // Rebalance triggers
  rebalanceThreshold: number; // Rebalance when price moves X% from center
  autoRebalance: boolean;

  // Risk parameters
  maxILPercent: number; // Max acceptable IL before alert
  minTVL: number; // Minimum pool TVL to consider

  // Best for
  bestFor: string[];
}

export interface StrategyRecommendation {
  strategy: StrategyTemplate;
  pool: LPPool;
  reasoning: string;
  expectedDailyYield: number;
  estimatedILRisk: string;
  confidence: number;
}

// ============ Strategy Definitions ============

export const STRATEGIES: Record<LPStrategy, StrategyTemplate> = {
  balanced: {
    id: "balanced",
    name: "Balanced",
    description:
      "Equal token split with moderate price range. Good starting point.",
    riskLevel: "medium",
    rangeWidthPercent: 20,
    rangeSkew: 0,
    rebalanceThreshold: 15,
    autoRebalance: false,
    maxILPercent: 10,
    minTVL: 100000,
    bestFor: ["beginners", "stable pairs", "set-and-forget"],
  },

  concentrated: {
    id: "concentrated",
    name: "Concentrated",
    description:
      "Tight range for maximum capital efficiency. Requires active management.",
    riskLevel: "high",
    rangeWidthPercent: 5,
    rangeSkew: 0,
    rebalanceThreshold: 3,
    autoRebalance: true,
    maxILPercent: 15,
    minTVL: 500000,
    bestFor: ["active traders", "high volume pairs", "fee maximizers"],
  },

  "yield-max": {
    id: "yield-max",
    name: "Yield Maximizer",
    description:
      "Wide range to capture more fees. Lower capital efficiency but more stable.",
    riskLevel: "medium",
    rangeWidthPercent: 50,
    rangeSkew: 0,
    rebalanceThreshold: 40,
    autoRebalance: false,
    maxILPercent: 8,
    minTVL: 50000,
    bestFor: ["passive income", "volatile pairs", "long-term holders"],
  },

  "delta-neutral": {
    id: "delta-neutral",
    name: "Delta Neutral",
    description:
      "Minimize directional exposure and impermanent loss. Lower yield but safer.",
    riskLevel: "low",
    rangeWidthPercent: 30,
    rangeSkew: 0,
    rebalanceThreshold: 10,
    autoRebalance: true,
    maxILPercent: 5,
    minTVL: 1000000,
    bestFor: ["risk-averse", "stablecoin pairs", "hedged positions"],
  },

  "bid-heavy": {
    id: "bid-heavy",
    name: "Accumulator (Bid Heavy)",
    description:
      "More liquidity on buy side. Accumulate token A as price drops.",
    riskLevel: "medium",
    rangeWidthPercent: 25,
    rangeSkew: -0.6, // 60% on buy side
    rebalanceThreshold: 20,
    autoRebalance: false,
    maxILPercent: 12,
    minTVL: 100000,
    bestFor: ["DCA strategy", "bullish on token A", "dip buyers"],
  },

  "ask-heavy": {
    id: "ask-heavy",
    name: "Distributor (Ask Heavy)",
    description: "More liquidity on sell side. Sell token A as price rises.",
    riskLevel: "medium",
    rangeWidthPercent: 25,
    rangeSkew: 0.6, // 60% on sell side
    rebalanceThreshold: 20,
    autoRebalance: false,
    maxILPercent: 12,
    minTVL: 100000,
    bestFor: ["taking profits", "bearish on token A", "exit strategy"],
  },
};

// ============ Strategy Selection ============

/**
 * Recommend a strategy based on user preferences
 */
export function recommendStrategy(preferences: {
  riskTolerance?: "low" | "medium" | "high";
  timeCommitment?: "passive" | "active";
  goal?: "yield" | "accumulate" | "hedge" | "profit-take";
  pairType?: "stable" | "volatile" | "correlated";
}): StrategyTemplate {
  const {
    riskTolerance = "medium",
    timeCommitment = "passive",
    goal = "yield",
    pairType = "volatile",
  } = preferences;

  // Stable pairs
  if (pairType === "stable") {
    return STRATEGIES["delta-neutral"];
  }

  // Correlated pairs (like mSOL-SOL)
  if (pairType === "correlated") {
    return STRATEGIES.concentrated;
  }

  // Goal-based
  if (goal === "accumulate") {
    return STRATEGIES["bid-heavy"];
  }
  if (goal === "profit-take") {
    return STRATEGIES["ask-heavy"];
  }
  if (goal === "hedge") {
    return STRATEGIES["delta-neutral"];
  }

  // Risk-based
  if (riskTolerance === "low") {
    return STRATEGIES["yield-max"]; // Wide range = safer
  }
  if (riskTolerance === "high" && timeCommitment === "active") {
    return STRATEGIES.concentrated;
  }

  // Default
  return STRATEGIES.balanced;
}

/**
 * Get strategy by ID
 */
export function getStrategy(id: LPStrategy): StrategyTemplate {
  return STRATEGIES[id] || STRATEGIES.balanced;
}

/**
 * List all strategies
 */
export function listStrategies(): StrategyTemplate[] {
  return Object.values(STRATEGIES);
}

// ============ Strategy Application ============

/**
 * Apply strategy to create LP parameters
 */
export function applyStrategy(
  strategy: StrategyTemplate,
  pool: LPPool,
  amountUSD: number,
): AddLiquidityIntent {
  const currentPrice = pool.priceRange?.current || 1;

  // Calculate range based on strategy
  const rangeMultiplier = strategy.rangeWidthPercent / 100;
  const skewAdjustment = strategy.rangeSkew * rangeMultiplier * 0.5;

  const lowerBound = currentPrice * (1 - rangeMultiplier + skewAdjustment);
  const upperBound = currentPrice * (1 + rangeMultiplier + skewAdjustment);

  // Split amount based on skew
  const tokenASplit = 0.5 - strategy.rangeSkew * 0.25; // 0.25-0.75 range
  const tokenBSplit = 1 - tokenASplit;

  return {
    venue: pool.venue,
    poolAddress: pool.address,
    tokenA: pool.tokenA.symbol,
    tokenB: pool.tokenB.symbol,
    totalValueUSD: amountUSD,
    strategy: strategy.id,
    slippageBps: 100, // 1%
  };
}

/**
 * Check if position needs rebalancing
 */
export function needsRebalance(
  strategy: StrategyTemplate,
  currentPrice: number,
  entryPrice: number,
  rangeCenter: number,
): { needsRebalance: boolean; reason?: string } {
  const priceChangePercent =
    Math.abs((currentPrice - rangeCenter) / rangeCenter) * 100;

  if (priceChangePercent > strategy.rebalanceThreshold) {
    return {
      needsRebalance: true,
      reason: `Price moved ${priceChangePercent.toFixed(1)}% from center (threshold: ${strategy.rebalanceThreshold}%)`,
    };
  }

  return { needsRebalance: false };
}

// ============ Display Helpers ============

/**
 * Format strategy for chat display
 */
export function formatStrategyForChat(strategy: StrategyTemplate): string {
  const riskEmoji = {
    low: "🟢",
    medium: "🟡",
    high: "🔴",
  }[strategy.riskLevel];

  return `**${strategy.name}** ${riskEmoji}
${strategy.description}

• Range: ±${strategy.rangeWidthPercent}% from current price
• Rebalance: ${strategy.autoRebalance ? "Auto" : "Manual"} at ${strategy.rebalanceThreshold}% move
• Best for: ${strategy.bestFor.join(", ")}`;
}

/**
 * Format all strategies as a menu
 */
export function formatStrategyMenu(): string {
  const strategies = listStrategies();

  let output = "📋 **LP Strategies**\n\n";

  strategies.forEach((s, i) => {
    const riskEmoji = { low: "🟢", medium: "🟡", high: "🔴" }[s.riskLevel];
    output += `${i + 1}. **${s.name}** ${riskEmoji}\n`;
    output += `   ${s.description.split(".")[0]}.\n\n`;
  });

  output += `💡 Tell me your goal and I'll recommend one!`;

  return output;
}

export default {
  STRATEGIES,
  recommendStrategy,
  getStrategy,
  listStrategies,
  applyStrategy,
  needsRebalance,
  formatStrategyForChat,
  formatStrategyMenu,
};
