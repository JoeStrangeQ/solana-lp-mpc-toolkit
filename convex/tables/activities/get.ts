import { query } from "../../_generated/server";
import { v } from "convex/values";

export const getActivityById = query({
  args: {
    id: v.id("activities"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getClaimedFeesByPosition = query({
  args: {
    positionPubkey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activities")
      .withIndex("by_position_type", (q) =>
        q
          .eq("relatedPositionPubkey", args.positionPubkey)
          .eq("type", "claim_fees"),
      )
      .collect();
  },
});
