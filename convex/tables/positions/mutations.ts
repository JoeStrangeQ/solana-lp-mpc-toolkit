import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { vPosition } from "../../schema/positions";

export const insertPosition = internalMutation({
  args: { input: vPosition.omit("closedAt", "isActive", "userId"), userId: v.id("users") },

  handler: async (ctx, args) => {
    const { userId, input } = args;
    const existing = await ctx.db
      .query("positions")
      .withIndex("by_position_pk", (q) => q.eq("positionPubkey", input.positionPubkey))
      .unique();

    if (existing) {
      return {
        id: existing._id,
        positionPubkey: existing.positionPubkey,
        created: false,
      };
    }

    return await ctx.db.insert("positions", {
      userId,
      type: input.type,
      positionPubkey: input.positionPubkey,
      poolAddress: input.poolAddress,
      poolEntryPrice: input.poolEntryPrice,

      collateral: input.collateral,
      tokenX: input.tokenX,
      tokenY: input.tokenY,

      details: input.details,
      leverage: input.leverage,

      isActive: true,
      closedAt: undefined,
    });
  },
});

export const closePositionByPubkey = internalMutation({
  args: {
    positionPubkey: v.string(),
  },
  handler: async (ctx, { positionPubkey }) => {
    const pos = await ctx.db
      .query("positions")
      .withIndex("by_position_pk", (q) => q.eq("positionPubkey", positionPubkey))
      .unique();

    if (!pos) {
      throw new Error(`Position not found for pubkey ${positionPubkey}`);
    }

    if (pos.isActive === false) {
      // idempotent: nothing to do
      return { id: pos._id, isActive: false, alreadyClosed: true };
    }

    const now = Date.now();
    await ctx.db.patch(pos._id, {
      isActive: false,
      closedAt: now,
    });

    return { id: pos._id, isActive: false, closedAt: now, alreadyClosed: false };
  },
});
