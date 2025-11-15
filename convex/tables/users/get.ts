import { v } from "convex/values";
import { query } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

export const getUserByAddress = query({
  args: {
    address: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db
      .query("users")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .unique();
  },
});

export const getUserByPrivyUserId = query({
  args: {
    privyUserId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db
      .query("users")
      .withIndex("by_privyUserId", (q) => q.eq("privyUserId", args.privyUserId))
      .unique();
  },
});
