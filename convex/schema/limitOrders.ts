import { Infer, v } from "convex/values";

const vOrderStatus = v.union(
  v.literal("pending"),
  v.literal("triggered"),
  v.literal("executing"),
  v.literal("executed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const vSupportedMarket = v.union(
  v.literal("SOL/USDC"),
  v.literal("MET/USDC"),
  v.literal("MET/SOL"),
);
export const vOrderDirection = v.union(v.literal("sl"), v.literal("tp"));
export const vSwapToOption = v.union(
  v.literal("SOL"),
  v.literal("USDC"),
  v.literal("none"),
);
export const vLimitOrderInput = v.object({
  price: v.number(),
  swapTo: vSwapToOption,
});

export type LimitOrderInput = Infer<typeof vLimitOrderInput>;
export type SwapToOption = Infer<typeof vSwapToOption>;
export type SupportedMarket = Infer<typeof vSupportedMarket>;
export type OrderDirection = Infer<typeof vOrderDirection>;

export const vOrder = v.object({
  // Core logic
  market: vSupportedMarket,
  swapTo: vSwapToOption,
  triggerPrice: v.number(), // price threshold
  direction: vOrderDirection,
  status: vOrderStatus,

  // Execution data
  positionPubkey: v.string(),
  percentageToWithdraw: v.number(), // 0–100

  // Metadata
  triggeredAt: v.optional(v.number()), // timestamp (ms)
  executedAt: v.optional(v.number()),
  executedActivityId: v.optional(v.id("activities")),

  // Retry + diagnostics
  retryCount: v.optional(v.number()),
  lastExecutionAttemptAt: v.optional(v.number()),
  errorMsg: v.optional(v.string()),

  // Ownership
  userId: v.id("users"),
});
