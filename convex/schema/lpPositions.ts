/**
 * LP Position Schema for Agent Toolkit
 * Tracks LP positions across multiple DEXs
 */

import { Infer, v } from "convex/values";

export const vDEXVenue = v.union(
  v.literal("meteora"),
  v.literal("orca"),
  v.literal("raydium"),
  v.literal("phoenix"),
);

export const vLPStrategy = v.union(
  v.literal("balanced"),
  v.literal("concentrated"),
  v.literal("bid-heavy"),
  v.literal("ask-heavy"),
  v.literal("delta-neutral"),
  v.literal("yield-max"),
);

export const vLPPosition = v.object({
  // Owner info
  ownerAddress: v.string(), // Solana wallet address
  agentId: v.optional(v.string()), // If created by an agent

  // Position identity
  venue: vDEXVenue,
  positionId: v.string(), // On-chain position ID
  poolAddress: v.string(),
  poolName: v.string(),

  // Token info
  tokenA: v.object({
    mint: v.string(),
    symbol: v.string(),
    amount: v.string(), // Raw amount as string for precision
    decimals: v.number(),
  }),
  tokenB: v.object({
    mint: v.string(),
    symbol: v.string(),
    amount: v.string(),
    decimals: v.number(),
  }),

  // Value tracking
  depositValueUSD: v.number(), // Value when deposited
  currentValueUSD: v.number(), // Latest known value
  lastValueUpdate: v.number(), // Timestamp

  // Fee tracking
  unclaimedFeesA: v.string(),
  unclaimedFeesB: v.string(),
  unclaimedFeesUSD: v.number(),
  totalFeesClaimedUSD: v.number(),

  // Range info (for concentrated liquidity)
  priceRange: v.optional(
    v.object({
      lower: v.number(),
      upper: v.number(),
    }),
  ),
  inRange: v.boolean(),

  // Strategy
  strategy: v.optional(vLPStrategy),

  // Timestamps
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
  isActive: v.boolean(),

  // Privacy (Arcium)
  isPrivate: v.boolean(),
  encryptedData: v.optional(v.string()), // Encrypted position details
  publicKey: v.optional(v.string()), // Owner's privacy public key
});

export type LPPositionDoc = Infer<typeof vLPPosition>;
export type DEXVenue = Infer<typeof vDEXVenue>;
export type LPStrategy = Infer<typeof vLPStrategy>;

// LP Operation log
export const vLPOperation = v.object({
  ownerAddress: v.string(),
  positionId: v.optional(v.string()),

  operation: v.union(
    v.literal("add_liquidity"),
    v.literal("remove_liquidity"),
    v.literal("claim_fees"),
    v.literal("rebalance"),
  ),

  venue: vDEXVenue,
  poolAddress: v.string(),
  poolName: v.string(),

  // Transaction details
  txSignature: v.optional(v.string()),
  amountUSD: v.number(),

  // Fee tracking (protocol fee)
  protocolFeePaid: v.number(),

  // Status
  status: v.union(
    v.literal("pending"),
    v.literal("confirmed"),
    v.literal("failed"),
  ),
  errorMessage: v.optional(v.string()),

  timestamp: v.number(),
});

export type LPOperationDoc = Infer<typeof vLPOperation>;
