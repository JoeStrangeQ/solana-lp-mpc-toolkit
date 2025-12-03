"use node";
import { v } from "convex/values";
import { components, internal } from "../../_generated/api";
import { ActionCache } from "@convex-dev/action-cache";
import { getActiveBin, getBinsAroundActiveBin, getDlmmPoolConn, SerializedBinLiquidity } from "../../services/meteora";
import { action, internalAction } from "../../_generated/server";
import { MS_1S } from "../../utils/timeframe";
import { PublicKey } from "@solana/web3.js";
import { serializePositionData } from "../../utils/meteora";

const binsAroundActiveBinCache = new ActionCache(components.actionCache, {
  action: internal.actions.fetch.dlmm.getBinsAroundActiveBinInternalAction,
  ttl: MS_1S * 5,
});

export const getBinsAroundActiveBinAction = action({
  args: {
    poolAddress: v.string(),
    numberOfBinsToTheLeft: v.number(),
    numberOfBinsToTheRight: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    activeBin: number;
    bins: SerializedBinLiquidity[];
  }> => {
    return await binsAroundActiveBinCache.fetch(ctx, args);
  },
});
export const getBinsAroundActiveBinInternalAction = internalAction({
  args: {
    poolAddress: v.string(),
    numberOfBinsToTheLeft: v.number(),
    numberOfBinsToTheRight: v.number(),
  },
  handler: async (_, args) => await getBinsAroundActiveBin(args),
});

///get active bin

const activeBinCache = new ActionCache(components.actionCache, {
  action: internal.actions.fetch.dlmm.getActiveBinInternalAction,
  ttl: MS_1S * 5,
});

export const getActiveBinAction = action({
  args: { poolAddress: v.string() },
  handler: async (ctx, args): Promise<SerializedBinLiquidity> => {
    return await activeBinCache.fetch(ctx, args);
  },
});
export const getActiveBinInternalAction = internalAction({
  args: { poolAddress: v.string() },
  handler: async (_, args) => await getActiveBin(args),
});

export const getOpenPosition = action({
  args: { poolAddress: v.string(), positionPubkey: v.string() },
  handler: async (_, args) => {
    try {
      const dlmmPoolConn = await getDlmmPoolConn(args.poolAddress);
      const res = await dlmmPoolConn.getPosition(new PublicKey(args.positionPubkey));
      return serializePositionData(res.positionData);
    } catch (err: any) {
      console.log(err);
      return null;
    }
  },
});
