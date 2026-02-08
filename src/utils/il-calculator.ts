/**
 * Impermanent Loss Calculator
 * 
 * Calculates IL for concentrated liquidity positions based on price movement.
 * Uses the standard IL formula adapted for CLMM range positions.
 */

export interface ILResult {
  /** IL as a percentage (e.g., -2.5 means 2.5% loss vs holding) */
  ilPercent: number;
  /** IL in USD value */
  ilUsd: number;
  /** Current position value in USD */
  currentValueUsd: number;
  /** Hypothetical hold value in USD (if you just held the tokens) */
  holdValueUsd: number;
  /** Whether position is currently in range */
  inRange: boolean;
  /** Human-readable summary */
  summary: string;
}

export interface ILParams {
  /** Entry price of token A in terms of token B */
  entryPrice: number;
  /** Current price of token A in terms of token B */
  currentPrice: number;
  /** Lower bound of the LP range */
  lowerPrice: number;
  /** Upper bound of the LP range */
  upperPrice: number;
  /** Initial amount of token A deposited */
  initialAmountA: number;
  /** Initial amount of token B deposited */
  initialAmountB: number;
  /** Current price of token A in USD (for value calculations) */
  tokenAUsdPrice: number;
  /** Current price of token B in USD */
  tokenBUsdPrice: number;
}

/**
 * Calculate impermanent loss for a concentrated liquidity position
 * 
 * For CLMM positions, IL is more complex than standard AMMs because:
 * 1. Liquidity is concentrated in a range
 * 2. When price exits range, composition changes dramatically
 * 3. IL can be higher but fees earned are also higher
 */
export function calculateIL(params: ILParams): ILResult {
  const {
    entryPrice,
    currentPrice,
    lowerPrice,
    upperPrice,
    initialAmountA,
    initialAmountB,
    tokenAUsdPrice,
    tokenBUsdPrice,
  } = params;

  // Check if price is in range
  const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;

  // Calculate initial USD value (what you put in)
  const initialValueUsd = 
    initialAmountA * (entryPrice * tokenBUsdPrice) + 
    initialAmountB * tokenBUsdPrice;

  // Calculate hold value (if you just held the initial tokens)
  const holdValueUsd = 
    initialAmountA * tokenAUsdPrice + 
    initialAmountB * tokenBUsdPrice;

  // Calculate current position composition based on price relative to range
  let currentAmountA: number;
  let currentAmountB: number;

  if (currentPrice <= lowerPrice) {
    // Price below range: 100% token A
    currentAmountA = initialAmountA + initialAmountB / lowerPrice;
    currentAmountB = 0;
  } else if (currentPrice >= upperPrice) {
    // Price above range: 100% token B
    currentAmountA = 0;
    currentAmountB = initialAmountB + initialAmountA * upperPrice;
  } else {
    // Price in range: calculate proportional split
    // Using simplified CLMM math
    const sqrtPriceCurrent = Math.sqrt(currentPrice);
    const sqrtPriceLower = Math.sqrt(lowerPrice);
    const sqrtPriceUpper = Math.sqrt(upperPrice);
    
    // Approximate liquidity based on initial deposit
    const totalValueAtEntry = initialAmountA * entryPrice + initialAmountB;
    const L = totalValueAtEntry / (2 * Math.sqrt(entryPrice));
    
    // Current amounts based on liquidity and price
    currentAmountA = L * (sqrtPriceUpper - sqrtPriceCurrent) / (sqrtPriceCurrent * sqrtPriceUpper);
    currentAmountB = L * (sqrtPriceCurrent - sqrtPriceLower);
    
    // Normalize to maintain reasonable values
    const scaleFactor = totalValueAtEntry / (currentAmountA * currentPrice + currentAmountB);
    currentAmountA *= scaleFactor;
    currentAmountB *= scaleFactor;
  }

  // Calculate current position value
  const currentValueUsd = 
    currentAmountA * tokenAUsdPrice + 
    currentAmountB * tokenBUsdPrice;

  // Calculate IL
  const ilUsd = currentValueUsd - holdValueUsd;
  const ilPercent = holdValueUsd > 0 ? (ilUsd / holdValueUsd) * 100 : 0;

  // Generate summary
  let summary: string;
  if (ilPercent > -0.5) {
    summary = '✅ Minimal IL';
  } else if (ilPercent > -2) {
    summary = '📊 Low IL';
  } else if (ilPercent > -5) {
    summary = '⚠️ Moderate IL';
  } else if (ilPercent > -10) {
    summary = '🔶 Significant IL';
  } else {
    summary = '🔴 High IL';
  }

  if (!inRange) {
    summary += ' (out of range)';
  }

  return {
    ilPercent: Math.round(ilPercent * 100) / 100,
    ilUsd: Math.round(ilUsd * 100) / 100,
    currentValueUsd: Math.round(currentValueUsd * 100) / 100,
    holdValueUsd: Math.round(holdValueUsd * 100) / 100,
    inRange,
    summary,
  };
}

/**
 * Estimate IL for a hypothetical position
 * Useful for showing users potential IL before they enter a position
 */
export function estimateILForPriceChange(
  priceChangePercent: number,
  rangeWidthPercent: number = 10,
): number {
  // Simplified IL estimation for a given price change
  // Uses standard AMM IL formula as a baseline, adjusted for range width
  const priceRatio = 1 + priceChangePercent / 100;
  
  // Standard AMM IL
  const standardIL = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
  
  // Adjust for concentrated liquidity (narrower range = higher IL)
  // This is a simplified approximation
  const rangeMultiplier = Math.max(1, 10 / rangeWidthPercent);
  
  return standardIL * rangeMultiplier * 100;
}

/**
 * Format IL for display
 */
export function formatIL(ilPercent: number): string {
  const sign = ilPercent >= 0 ? '+' : '';
  const emoji = ilPercent >= 0 ? '📈' : '📉';
  return `${emoji} ${sign}${ilPercent.toFixed(2)}% IL`;
}
