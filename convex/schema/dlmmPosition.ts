import { v } from "convex/values";

export const vDepositedToken = v.object({
  mint: v.string(),
  decimals: v.number(),
  amount: v.number(),
});

export const vPairToken= v.object({
  mint: v.string(),
  decimals: v.number(),
  split: v.number(), // must be between 0-1
});

export const vBinIdAndPrice = v.object({
  id: v.number(),
  price: v.number(),
});

export const vLiquidityStrategy = v.union(v.literal("Spot"), v.literal("Curve"), v.literal("BidAsk"));

export const vPnlBreakdown = v.object({
  feeUsd: v.number(),
  totalUsd: v.number(),
  totalPct: v.number(),
});
