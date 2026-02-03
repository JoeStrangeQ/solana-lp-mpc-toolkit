import { Infer, v } from "convex/values";

export const vPositionType = v.union(v.literal("DLMM"), v.literal("CLMM"));

export const vTokenAmount = v.object({
  mint: v.string(),
  rawAmount: v.number(),
  usdPrice: v.number(),
});
export const vBinIdAndPrice = v.object({
  id: v.number(),
  price: v.number(),
});
export const vLiquidityShape = v.union(
  v.literal("Spot"),
  v.literal("Curve"),
  v.literal("BidAsk"),
);

const vDLMMDetails = v.object({
  lowerBin: vBinIdAndPrice,
  upperBin: vBinIdAndPrice,
  liquidityStrategy: vLiquidityShape,
  autoCompoundSplit: v.number(),
});

const vPositionDetails = v.union(vDLMMDetails);

export const vPosition = v.object({
  userId: v.id("users"),
  type: vPositionType,
  positionPubkey: v.string(),
  poolAddress: v.string(),
  poolEntryPrice: v.number(),

  collateral: vTokenAmount,
  tokenX: vTokenAmount,
  tokenY: vTokenAmount,

  details: vPositionDetails,
  //TODO: add leverage details here , this should be global and applied to all of the position the same way
  leverage: v.optional(v.number()),
  loanAddress: v.optional(v.string()),

  closedAt: v.optional(v.number()),
  isActive: v.boolean(),
});

export type PositionTokenAmount = Infer<typeof vTokenAmount>;
export type BinIdAndPrice = Infer<typeof vBinIdAndPrice>;
