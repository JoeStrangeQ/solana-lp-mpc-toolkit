/**
 * MnM Risk Calculations
 * Liquidation logic, risk thresholds, and safety calculations
 */

import BN from "bn.js";

// ============ Risk Parameters ============

export const RISK_PARAMS = {
  // Maximum Loan-to-Value ratio (80%)
  MAX_LTV: 0.8,

  // Liquidation threshold (85%) - when position becomes liquidatable
  LIQUIDATION_THRESHOLD: 0.85,

  // Liquidation penalty/bonus for liquidators (5%)
  LIQUIDATION_PENALTY: 0.05,

  // Health factor warning threshold
  HEALTH_FACTOR_WARNING: 1.2,

  // Health factor danger threshold
  HEALTH_FACTOR_DANGER: 1.1,

  // Minimum health factor for new positions
  MIN_INITIAL_HEALTH_FACTOR: 1.3,

  // Maximum leverage (derived from MAX_LTV)
  MAX_LEVERAGE: 1 / (1 - 0.8), // 5x

  // Price impact limits
  MAX_PRICE_IMPACT_BPS: 100, // 1%

  // Slippage tolerance default
  DEFAULT_SLIPPAGE_BPS: 50, // 0.5%
};

// ============ Types ============

export interface PositionRisk {
  healthFactor: number;
  currentLTV: number;
  liquidationPrice: number;
  safetyMargin: number; // Distance from liquidation as %
  status: "healthy" | "warning" | "danger" | "liquidatable";
  requiredCollateralToSafe: number; // Amount needed to reach warning threshold
  maxWithdrawable: number; // Amount that can be withdrawn while staying safe
}

export interface LiquidationInfo {
  isLiquidatable: boolean;
  collateralToSeize: number;
  debtToRepay: number;
  liquidatorBonus: number;
  remainingCollateral: number;
  remainingDebt: number;
}

// ============ Health Factor Calculations ============

/**
 * Calculate health factor
 * Health Factor = (Collateral Value * Liquidation Threshold) / Debt
 * HF < 1 means liquidatable
 */
export function calculateHealthFactor(
  collateralValueUSD: number,
  debtValueUSD: number,
): number {
  if (debtValueUSD === 0) return Infinity;
  return (
    (collateralValueUSD * RISK_PARAMS.LIQUIDATION_THRESHOLD) / debtValueUSD
  );
}

/**
 * Calculate current LTV (Loan-to-Value)
 * LTV = Debt / Collateral
 */
export function calculateLTV(
  collateralValueUSD: number,
  debtValueUSD: number,
): number {
  if (collateralValueUSD === 0) return Infinity;
  return debtValueUSD / collateralValueUSD;
}

/**
 * Get risk status from health factor
 */
export function getRiskStatus(
  healthFactor: number,
): "healthy" | "warning" | "danger" | "liquidatable" {
  if (healthFactor < 1) return "liquidatable";
  if (healthFactor < RISK_PARAMS.HEALTH_FACTOR_DANGER) return "danger";
  if (healthFactor < RISK_PARAMS.HEALTH_FACTOR_WARNING) return "warning";
  return "healthy";
}

/**
 * Calculate comprehensive position risk
 */
export function calculatePositionRisk(
  collateralValueUSD: number,
  debtValueUSD: number,
  collateralPriceUSD: number, // Per unit of collateral
): PositionRisk {
  const healthFactor = calculateHealthFactor(collateralValueUSD, debtValueUSD);
  const currentLTV = calculateLTV(collateralValueUSD, debtValueUSD);
  const status = getRiskStatus(healthFactor);

  // Calculate liquidation price
  // Liquidation occurs when: collateralValue * liquidationThreshold = debt
  // So: newPrice * collateralUnits * liquidationThreshold = debt
  // newPrice = debt / (collateralUnits * liquidationThreshold)
  const collateralUnits = collateralValueUSD / collateralPriceUSD;
  const liquidationPrice =
    collateralUnits > 0
      ? debtValueUSD / (collateralUnits * RISK_PARAMS.LIQUIDATION_THRESHOLD)
      : 0;

  // Safety margin: how far from liquidation price (as %)
  const safetyMargin =
    collateralPriceUSD > liquidationPrice
      ? ((collateralPriceUSD - liquidationPrice) / collateralPriceUSD) * 100
      : 0;

  // Calculate collateral needed to reach warning threshold
  // Target HF = 1.2
  // Required collateral = (debt * targetHF) / liquidationThreshold
  const targetHF = RISK_PARAMS.HEALTH_FACTOR_WARNING;
  const requiredCollateral =
    (debtValueUSD * targetHF) / RISK_PARAMS.LIQUIDATION_THRESHOLD;
  const requiredCollateralToSafe = Math.max(
    0,
    requiredCollateral - collateralValueUSD,
  );

  // Calculate max withdrawable while maintaining warning threshold
  const minCollateral =
    (debtValueUSD * targetHF) / RISK_PARAMS.LIQUIDATION_THRESHOLD;
  const maxWithdrawable = Math.max(0, collateralValueUSD - minCollateral);

  return {
    healthFactor,
    currentLTV,
    liquidationPrice,
    safetyMargin,
    status,
    requiredCollateralToSafe,
    maxWithdrawable,
  };
}

// ============ Liquidation Calculations ============

/**
 * Calculate if position is liquidatable and liquidation amounts
 */
export function calculateLiquidation(
  collateralValueUSD: number,
  debtValueUSD: number,
): LiquidationInfo {
  const healthFactor = calculateHealthFactor(collateralValueUSD, debtValueUSD);
  const isLiquidatable = healthFactor < 1;

  if (!isLiquidatable) {
    return {
      isLiquidatable: false,
      collateralToSeize: 0,
      debtToRepay: 0,
      liquidatorBonus: 0,
      remainingCollateral: collateralValueUSD,
      remainingDebt: debtValueUSD,
    };
  }

  // Liquidation logic:
  // Liquidator repays debt and receives collateral + bonus
  // We allow partial liquidation up to 50% of debt per tx
  const maxLiquidationRatio = 0.5; // 50% max per liquidation

  const debtToRepay = debtValueUSD * maxLiquidationRatio;
  const collateralToSeize = debtToRepay * (1 + RISK_PARAMS.LIQUIDATION_PENALTY);
  const liquidatorBonus = debtToRepay * RISK_PARAMS.LIQUIDATION_PENALTY;

  // Cap seizure at available collateral
  const actualCollateralSeized = Math.min(
    collateralToSeize,
    collateralValueUSD,
  );
  const actualDebtRepaid =
    actualCollateralSeized / (1 + RISK_PARAMS.LIQUIDATION_PENALTY);

  return {
    isLiquidatable: true,
    collateralToSeize: actualCollateralSeized,
    debtToRepay: actualDebtRepaid,
    liquidatorBonus: actualCollateralSeized - actualDebtRepaid,
    remainingCollateral: collateralValueUSD - actualCollateralSeized,
    remainingDebt: debtValueUSD - actualDebtRepaid,
  };
}

/**
 * Check if a borrow amount would be safe
 */
export function validateBorrow(
  currentCollateralValueUSD: number,
  currentDebtUSD: number,
  newBorrowUSD: number,
): { valid: boolean; error?: string; newHealthFactor: number } {
  const newDebt = currentDebtUSD + newBorrowUSD;
  const newHealthFactor = calculateHealthFactor(
    currentCollateralValueUSD,
    newDebt,
  );

  if (newHealthFactor < RISK_PARAMS.MIN_INITIAL_HEALTH_FACTOR) {
    return {
      valid: false,
      error: `Borrow would result in health factor ${newHealthFactor.toFixed(2)}, minimum required is ${RISK_PARAMS.MIN_INITIAL_HEALTH_FACTOR}`,
      newHealthFactor,
    };
  }

  const newLTV = calculateLTV(currentCollateralValueUSD, newDebt);
  if (newLTV > RISK_PARAMS.MAX_LTV) {
    return {
      valid: false,
      error: `Borrow would exceed maximum LTV of ${RISK_PARAMS.MAX_LTV * 100}%`,
      newHealthFactor,
    };
  }

  return { valid: true, newHealthFactor };
}

/**
 * Check if a withdrawal would be safe
 */
export function validateWithdrawal(
  currentCollateralValueUSD: number,
  currentDebtUSD: number,
  withdrawalUSD: number,
): { valid: boolean; error?: string; newHealthFactor: number } {
  const newCollateral = currentCollateralValueUSD - withdrawalUSD;

  if (newCollateral < 0) {
    return {
      valid: false,
      error: "Cannot withdraw more than deposited",
      newHealthFactor: 0,
    };
  }

  const newHealthFactor = calculateHealthFactor(newCollateral, currentDebtUSD);

  if (newHealthFactor < RISK_PARAMS.MIN_INITIAL_HEALTH_FACTOR) {
    return {
      valid: false,
      error: `Withdrawal would result in health factor ${newHealthFactor.toFixed(2)}, minimum required is ${RISK_PARAMS.MIN_INITIAL_HEALTH_FACTOR}`,
      newHealthFactor,
    };
  }

  return { valid: true, newHealthFactor };
}

// ============ Price Impact & Slippage ============

/**
 * Estimate price impact for a given trade size
 */
export function estimatePriceImpact(
  tradeSize: number,
  poolLiquidity: number,
): number {
  // Simple constant product model: impact ≈ tradeSize / liquidity
  // Real DLMM would be more complex due to bins
  return (tradeSize / poolLiquidity) * 100;
}

/**
 * Check if trade size is within acceptable price impact
 */
export function validatePriceImpact(
  tradeSize: number,
  poolLiquidity: number,
  maxImpactBps: number = RISK_PARAMS.MAX_PRICE_IMPACT_BPS,
): { valid: boolean; estimatedImpact: number } {
  const impact = estimatePriceImpact(tradeSize, poolLiquidity);
  const impactBps = impact * 100;

  return {
    valid: impactBps <= maxImpactBps,
    estimatedImpact: impact,
  };
}

// ============ Leverage Calculations ============

/**
 * Calculate effective leverage from LTV
 */
export function calculateEffectiveLeverage(ltv: number): number {
  if (ltv >= 1) return Infinity;
  return 1 / (1 - ltv);
}

/**
 * Calculate required LTV for target leverage
 */
export function calculateRequiredLTV(targetLeverage: number): number {
  if (targetLeverage <= 1) return 0;
  return 1 - 1 / targetLeverage;
}

/**
 * Calculate max borrow for given collateral and target health factor
 */
export function calculateMaxBorrow(
  collateralValueUSD: number,
  targetHealthFactor: number = RISK_PARAMS.MIN_INITIAL_HEALTH_FACTOR,
): number {
  // HF = (collateral * liquidationThreshold) / debt
  // debt = (collateral * liquidationThreshold) / HF
  return (
    (collateralValueUSD * RISK_PARAMS.LIQUIDATION_THRESHOLD) /
    targetHealthFactor
  );
}

// ============ Export ============

export default {
  RISK_PARAMS,
  calculateHealthFactor,
  calculateLTV,
  getRiskStatus,
  calculatePositionRisk,
  calculateLiquidation,
  validateBorrow,
  validateWithdrawal,
  estimatePriceImpact,
  validatePriceImpact,
  calculateEffectiveLeverage,
  calculateRequiredLTV,
  calculateMaxBorrow,
};
