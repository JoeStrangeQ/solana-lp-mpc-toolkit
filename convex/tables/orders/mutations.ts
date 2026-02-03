import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import {
  vLimitOrderInput,
  vOrderDirection,
  vSupportedMarket,
} from "../../schema/limitOrders";

export const createOrder = mutation({
  args: {
    userId: v.id("users"),
    market: vSupportedMarket,
    direction: vOrderDirection,
    orderInput: vLimitOrderInput,
    positionPubkey: v.string(),
    percentageToWithdraw: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("orders", {
      userId: args.userId,
      // Core
      market: args.market,
      direction: args.direction,
      triggerPrice: args.orderInput.price,
      swapTo: args.orderInput.swapTo,
      status: "pending",

      // Execution
      positionPubkey: args.positionPubkey,
      percentageToWithdraw: args.percentageToWithdraw,

      retryCount: 0,
    });
  },
});

export const updateOrder = mutation({
  args: {
    orderId: v.id("orders"),
    orderInput: vLimitOrderInput,
  },
  handler: async (ctx, args) => {
    const { orderId, orderInput } = args;

    // Update fields
    await ctx.db.patch(orderId, {
      triggerPrice: orderInput.price,
      swapTo: orderInput.swapTo,
    });

    return { success: true };
  },
});

export const cancelOrder = mutation({
  args: {
    orderId: v.id("orders"),
    reason: v.optional(v.string()), // optional, useful for debugging
  },

  handler: async (ctx, args) => {
    const { orderId, reason } = args;

    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");

    // Already canceled? No-op (safe for idempotency)
    if (order.status === "canceled") {
      return { success: true, alreadyCanceled: true };
    }

    await ctx.db.patch(orderId, {
      status: "canceled",
      errorMsg: reason ?? undefined,
    });

    return { success: true };
  },
});

export const cancelOrdersForPosition = internalMutation({
  args: {
    positionPubkey: v.string(),
  },
  handler: async (ctx, { positionPubkey }) => {
    // Find all pending orders for this position
    const ordersToClose = await ctx.db
      .query("orders")
      .withIndex("by_position_pk", (q) =>
        q.eq("positionPubkey", positionPubkey),
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    if (ordersToClose.length > 0) {
      await Promise.all(
        ordersToClose.map((o) =>
          ctx.db.patch(o._id, {
            status: "canceled",
            errorMsg: "Position Closed",
          }),
        ),
      );
    }
  },
});

export const markOrderAsTriggered = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    return await ctx.db.patch(orderId, {
      status: "triggered",
      triggeredAt: Date.now(),
    });
  },
});

export const markOrderAsExecuting = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    return await ctx.db.patch(orderId, {
      status: "executing",
      lastExecutionAttemptAt: Date.now(),
    });
  },
});

export const markOrderAsExecuted = internalMutation({
  args: { orderId: v.id("orders"), activityId: v.id("activities") },
  handler: async (ctx, { orderId, activityId }) => {
    return await ctx.db.patch(orderId, {
      status: "executed",
      executedActivityId: activityId,
      executedAt: Date.now(),
    });
  },
});

export const markOrderAsRetry = internalMutation({
  args: { orderId: v.id("orders"), errorMsg: v.string() },
  handler: async (ctx, { orderId, errorMsg }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");
    return await ctx.db.patch(orderId, {
      status: "failed",
      errorMsg,
      retryCount: order.retryCount ?? 0 + 1,
    });
  },
});
