/**
 * Input Validation for API Endpoints
 * Ensures all inputs are safe and valid before processing
 */

import { PublicKey } from "@solana/web3.js";

// ============ Validation Results ============

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: any;
}

// ============ Public Key Validation ============

/**
 * Validate a Solana public key
 */
export function validatePublicKey(input: any): ValidationResult {
  if (!input) {
    return { valid: false, error: "Public key is required" };
  }

  if (typeof input !== "string") {
    return { valid: false, error: "Public key must be a string" };
  }

  // Check length (base58 encoded public keys are 32-44 chars)
  if (input.length < 32 || input.length > 44) {
    return { valid: false, error: "Invalid public key length" };
  }

  // Check for valid base58 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  if (!base58Regex.test(input)) {
    return { valid: false, error: "Invalid base58 characters in public key" };
  }

  // Try to construct PublicKey
  try {
    new PublicKey(input);
    return { valid: true, sanitized: input.trim() };
  } catch {
    return { valid: false, error: "Invalid Solana public key format" };
  }
}

// ============ Amount Validation ============

/**
 * Validate a numeric amount
 */
export function validateAmount(
  input: any,
  options?: {
    min?: number;
    max?: number;
    allowZero?: boolean;
  },
): ValidationResult {
  const {
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    allowZero = false,
  } = options || {};

  // Convert to number if string
  let num: number;
  if (typeof input === "string") {
    num = parseFloat(input);
  } else if (typeof input === "number") {
    num = input;
  } else {
    return { valid: false, error: "Amount must be a number" };
  }

  // Check for NaN
  if (isNaN(num)) {
    return { valid: false, error: "Amount is not a valid number" };
  }

  // Check for Infinity
  if (!isFinite(num)) {
    return { valid: false, error: "Amount cannot be infinite" };
  }

  // Check for negative
  if (num < 0) {
    return { valid: false, error: "Amount cannot be negative" };
  }

  // Check for zero
  if (num === 0 && !allowZero) {
    return { valid: false, error: "Amount cannot be zero" };
  }

  // Check bounds
  if (num < min) {
    return { valid: false, error: `Amount must be at least ${min}` };
  }

  if (num > max) {
    return { valid: false, error: `Amount cannot exceed ${max}` };
  }

  return { valid: true, sanitized: num };
}

// ============ Token Symbol Validation ============

const VALID_TOKENS = [
  "SOL",
  "USDC",
  "USDT",
  "BONK",
  "JTO",
  "JUP",
  "RAY",
  "MSOL",
  "STSOL",
  "WIF",
  "PYTH",
];

/**
 * Validate a token symbol
 */
export function validateTokenSymbol(input: any): ValidationResult {
  if (!input) {
    return { valid: false, error: "Token symbol is required" };
  }

  if (typeof input !== "string") {
    return { valid: false, error: "Token symbol must be a string" };
  }

  const sanitized = input.trim().toUpperCase();

  // Check length
  if (sanitized.length < 2 || sanitized.length > 10) {
    return { valid: false, error: "Invalid token symbol length" };
  }

  // Check for valid characters
  if (!/^[A-Z0-9]+$/.test(sanitized)) {
    return {
      valid: false,
      error: "Token symbol can only contain letters and numbers",
    };
  }

  // Warn if unknown token (but still allow)
  const isKnown = VALID_TOKENS.includes(sanitized);

  return {
    valid: true,
    sanitized,
    ...(isKnown
      ? {}
      : { error: `Warning: ${sanitized} is not a recognized token` }),
  };
}

// ============ Venue Validation ============

const VALID_VENUES = [
  "meteora",
  "meteora-damm",
  "orca",
  "raydium",
  "lifinity",
  "saber",
  "crema",
  "fluxbeam",
  "invariant",
];

/**
 * Validate a DEX venue
 */
export function validateVenue(input: any): ValidationResult {
  if (!input) {
    return { valid: true, sanitized: "meteora" }; // Default
  }

  if (typeof input !== "string") {
    return { valid: false, error: "Venue must be a string" };
  }

  const sanitized = input.trim().toLowerCase();

  if (!VALID_VENUES.includes(sanitized)) {
    return {
      valid: false,
      error: `Invalid venue. Must be one of: ${VALID_VENUES.join(", ")}`,
    };
  }

  return { valid: true, sanitized };
}

// ============ Slippage Validation ============

/**
 * Validate slippage in basis points
 */
export function validateSlippage(input: any): ValidationResult {
  if (input === undefined || input === null) {
    return { valid: true, sanitized: 100 }; // Default 1%
  }

  const result = validateAmount(input, { min: 1, max: 5000, allowZero: false });

  if (!result.valid) {
    return {
      valid: false,
      error: "Slippage must be 1-5000 basis points (0.01% - 50%)",
    };
  }

  return { valid: true, sanitized: Math.floor(result.sanitized) };
}

// ============ Strategy Validation ============

const VALID_STRATEGIES = [
  "balanced",
  "concentrated",
  "yield-max",
  "delta-neutral",
  "bid-heavy",
  "ask-heavy",
];

/**
 * Validate LP strategy
 */
export function validateStrategy(input: any): ValidationResult {
  if (!input) {
    return { valid: true, sanitized: "balanced" }; // Default
  }

  if (typeof input !== "string") {
    return { valid: false, error: "Strategy must be a string" };
  }

  const sanitized = input.trim().toLowerCase();

  if (!VALID_STRATEGIES.includes(sanitized)) {
    return {
      valid: false,
      error: `Invalid strategy. Must be one of: ${VALID_STRATEGIES.join(", ")}`,
    };
  }

  return { valid: true, sanitized };
}

// ============ Percentage Validation ============

/**
 * Validate a percentage (0-100)
 */
export function validatePercentage(input: any): ValidationResult {
  if (input === undefined || input === null) {
    return { valid: true, sanitized: 100 }; // Default 100%
  }

  const result = validateAmount(input, { min: 1, max: 100, allowZero: false });

  if (!result.valid) {
    return { valid: false, error: "Percentage must be 1-100" };
  }

  return { valid: true, sanitized: Math.floor(result.sanitized) };
}

// ============ Composite Validators ============

/**
 * Validate add liquidity request
 */
export function validateAddLiquidityRequest(body: any): ValidationResult {
  const errors: string[] = [];
  const sanitized: any = {};

  // Required: userPubkey
  const pubkeyResult = validatePublicKey(body.userPubkey);
  if (!pubkeyResult.valid) {
    errors.push(`userPubkey: ${pubkeyResult.error}`);
  } else {
    sanitized.userPubkey = pubkeyResult.sanitized;
  }

  // Required: tokenA
  const tokenAResult = validateTokenSymbol(body.tokenA);
  if (!tokenAResult.valid) {
    errors.push(`tokenA: ${tokenAResult.error}`);
  } else {
    sanitized.tokenA = tokenAResult.sanitized;
  }

  // Required: tokenB
  const tokenBResult = validateTokenSymbol(body.tokenB);
  if (!tokenBResult.valid) {
    errors.push(`tokenB: ${tokenBResult.error}`);
  } else {
    sanitized.tokenB = tokenBResult.sanitized;
  }

  // Optional: venue
  const venueResult = validateVenue(body.venue);
  if (!venueResult.valid) {
    errors.push(`venue: ${venueResult.error}`);
  } else {
    sanitized.venue = venueResult.sanitized;
  }

  // Optional: amounts
  if (body.amountA !== undefined) {
    const amountAResult = validateAmount(body.amountA, {
      min: 0,
      allowZero: true,
    });
    if (!amountAResult.valid) {
      errors.push(`amountA: ${amountAResult.error}`);
    } else {
      sanitized.amountA = amountAResult.sanitized;
    }
  }

  if (body.amountB !== undefined) {
    const amountBResult = validateAmount(body.amountB, {
      min: 0,
      allowZero: true,
    });
    if (!amountBResult.valid) {
      errors.push(`amountB: ${amountBResult.error}`);
    } else {
      sanitized.amountB = amountBResult.sanitized;
    }
  }

  // Optional: slippage
  const slippageResult = validateSlippage(body.slippageBps);
  if (!slippageResult.valid) {
    errors.push(`slippageBps: ${slippageResult.error}`);
  } else {
    sanitized.slippageBps = slippageResult.sanitized;
  }

  // Optional: poolAddress
  if (body.poolAddress) {
    const poolResult = validatePublicKey(body.poolAddress);
    if (!poolResult.valid) {
      errors.push(`poolAddress: ${poolResult.error}`);
    } else {
      sanitized.poolAddress = poolResult.sanitized;
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join("; ") };
  }

  return { valid: true, sanitized };
}

/**
 * Validate encrypt strategy request
 */
export function validateEncryptRequest(body: any): ValidationResult {
  const errors: string[] = [];
  const sanitized: any = {};

  // Required: ownerPubkey
  const pubkeyResult = validatePublicKey(body.ownerPubkey);
  if (!pubkeyResult.valid) {
    errors.push(`ownerPubkey: ${pubkeyResult.error}`);
  } else {
    sanitized.ownerPubkey = pubkeyResult.sanitized;
  }

  // Required: strategy object
  if (!body.strategy || typeof body.strategy !== "object") {
    errors.push("strategy: must be an object");
  } else {
    sanitized.strategy = {};

    if (body.strategy.tokenA) {
      const result = validateTokenSymbol(body.strategy.tokenA);
      sanitized.strategy.tokenA = result.sanitized || body.strategy.tokenA;
    }

    if (body.strategy.tokenB) {
      const result = validateTokenSymbol(body.strategy.tokenB);
      sanitized.strategy.tokenB = result.sanitized || body.strategy.tokenB;
    }

    if (body.strategy.totalValueUSD !== undefined) {
      const result = validateAmount(body.strategy.totalValueUSD, { min: 0.01 });
      if (!result.valid) {
        errors.push(`strategy.totalValueUSD: ${result.error}`);
      } else {
        sanitized.strategy.totalValueUSD = result.sanitized;
      }
    }

    if (body.strategy.strategy) {
      const result = validateStrategy(body.strategy.strategy);
      sanitized.strategy.strategy = result.sanitized || "balanced";
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join("; ") };
  }

  return { valid: true, sanitized };
}

export default {
  validatePublicKey,
  validateAmount,
  validateTokenSymbol,
  validateVenue,
  validateSlippage,
  validateStrategy,
  validatePercentage,
  validateAddLiquidityRequest,
  validateEncryptRequest,
};
