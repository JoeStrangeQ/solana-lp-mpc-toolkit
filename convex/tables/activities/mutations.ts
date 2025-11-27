import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { vActivityInput } from "../../schema/activities";

export const createActivity = internalMutation({
  args: { input: vActivityInput, userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.insert("activities", {
      ...args.input,
      userId: args.userId,
      relatedPositionPubkey: args.input.relatedPositionPubkey ?? undefined,
      transactionIds: args.input.transactionIds ?? [],
    });
  },
});
