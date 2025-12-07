import { v } from "convex/values";
import { query } from "../../_generated/server";
import { vOrderDirection, vSupportedMarket } from "../../schema/limitOrders";

export const getOrdersToTrigger = query({
  args: {
    market: vSupportedMarket,
    direction: vOrderDirection,
    currentPrice: v.number(),
  },
  handler: async (ctx, { market, direction, currentPrice }) => {
    if (direction === "sl") {
      return await ctx.db
        .query("orders")
        .withIndex("by_market_direction_price", (q) =>
          q.eq("market", market).eq("direction", direction).gte("triggerPrice", currentPrice)
        )
        .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "failed")))
        .collect();
    }

    return await ctx.db
      .query("orders")
      .withIndex("by_market_direction_price", (q) =>
        q.eq("market", market).eq("direction", direction).lte("triggerPrice", currentPrice)
      )
      .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "failed")))
      .collect();
  },
});

export const getOrdersByPosition = query({
  args: { positionPubkey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orders")
      .withIndex("by_position_pk", (q) => q.eq("positionPubkey", args.positionPubkey))
      .filter((q) => q.and(q.neq(q.field("status"), "canceled"), q.neq(q.field("status"), "executed")))
      .collect();
  },
});
