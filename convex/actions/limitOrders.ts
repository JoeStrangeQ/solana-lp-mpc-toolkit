// convex/actions/orders/trigger.ts
"use node";

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import {
  vOrder,
  vOrderDirection,
  vSupportedMarket,
} from "../schema/limitOrders";
import { orderExecutionWorkPool } from "../workPools";
import { mints } from "../utils/solana";

export const triggerOrders = action({
  args: {
    market: vSupportedMarket,
    currentPrice: v.number(),
    direction: vOrderDirection,
  },
  handler: async (ctx, { market, currentPrice, direction }) => {
    // ---- 1. FIND MATCHING ORDERS ----

    const ordersToTrigger = await ctx.runQuery(
      api.tables.orders.get.getOrdersToTrigger,
      {
        market,
        direction,
        currentPrice,
      },
    );

    if (ordersToTrigger.length === 0) {
      // console.log(`${direction} at ${currentPrice} for ${market} triggered ${ordersToTrigger.length} orders `);
      return;
    }
    await Promise.all(
      ordersToTrigger.map((order) =>
        ctx.runMutation(internal.tables.orders.mutations.markOrderAsTriggered, {
          orderId: order._id,
        }),
      ),
    );

    const argsArray = ordersToTrigger.map((order) => ({
      order,
      orderId: order._id,
      positionPubkey: order.positionPubkey,
      percentageToWithdraw: order.percentageToWithdraw,
    }));

    const workIds = await orderExecutionWorkPool.enqueueActionBatch(
      ctx,
      internal.actions.limitOrders.executeOrder,
      argsArray,
      {
        //no retry for now as we mark the order failed and our server will detect it again next time
        // retry: {
        //   maxAttempts: 1,
        //   initialBackoffMs: 1000,
        //   base: 2,
        // },
        // onComplete: will add it to log our limit order results
      },
    );

    console.log(
      `${direction} at ${currentPrice} for ${market} triggered ${ordersToTrigger.length} orders `,
    );
    console.log(`${workIds.length} workers enqueued`);
  },
});

type ExecutionResult =
  | { ok: true; activityId: string }
  | { ok: false; error: string };

export const executeOrder = internalAction({
  args: {
    order: v.object({
      ...vOrder.fields,
      _id: v.string(),
      _creationTime: v.number(),
    }),
    orderId: v.id("orders"),
    positionPubkey: v.string(),
    percentageToWithdraw: v.number(),
  },
  handler: async (ctx, args): Promise<ExecutionResult> => {
    const { order, orderId, positionPubkey, percentageToWithdraw } = args;

    try {
      console.log("[executeOrder] Starting", orderId, positionPubkey);

      // Prevent double execution
      if (order.status === "executed" || order.status === "executing") {
        console.warn(
          "Order already executed or is currently executing:",
          orderId,
        );
        return { ok: true, activityId: order.executedActivityId ?? "" };
      }

      // --- 3. Mark order as executing ---
      await ctx.runMutation(
        internal.tables.orders.mutations.markOrderAsExecuting,
        { orderId },
      );

      let outputMint = undefined;
      if (order.swapTo === "SOL") outputMint = mints.sol;
      if (order.swapTo === "USDC") outputMint = mints.usdc;
      //TODO: handle swap to none , this should swap at all
      // have a flag disable swap for that

      const res = await ctx.runAction(
        internal.actions.dlmmPosition.removeLiquidity.internalRemoveLiquidity,
        {
          positionPubkey,
          percentageToWithdraw,
          outputMint,
          trigger: order.direction,
          userId: order.userId,
        },
      );

      if (!res || res.status === "failed") {
        console.error("removeLiquidity with limit order failed", res?.errorMsg);
        await ctx.runMutation(
          internal.tables.orders.mutations.markOrderAsRetry,
          { orderId, errorMsg: res.errorMsg },
        );
        //handle errors
        return {
          ok: false,
          error: res?.errorMsg ?? "REMOVE_LIQUIDITY_FAILED",
        };
      }

      const activityId = res.result.activityId;

      // --- 5. Update order as completed ---
      await ctx.runMutation(
        internal.tables.orders.mutations.markOrderAsExecuted,
        { orderId, activityId },
      );
      console.log("✅ Order executed:", orderId, activityId);
      return { ok: true, activityId };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error("Worker crashed:", message);
      await ctx.runMutation(internal.tables.orders.mutations.markOrderAsRetry, {
        orderId,
        errorMsg: message ?? "Limit order worker crashed",
      });

      //should check why the remove liquidity failed , and act accordingly.
      //must set the correct status
      return {
        ok: false,
        error: message,
      };
    }
  },
});
