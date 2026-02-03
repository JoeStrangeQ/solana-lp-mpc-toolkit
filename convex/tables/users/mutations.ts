import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

export const getOrCreateUser = internalMutation({
  args: {
    privyUserId: v.string(),
    address: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ user: Doc<"users">; wasCreated: boolean }> => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_privyUserId", (q) => q.eq("privyUserId", args.privyUserId))
      .unique();

    if (existing) {
      return { user: existing, wasCreated: false };
    }

    const _id = await ctx.db.insert("users", {
      address: args.address,
      privyUserId: args.privyUserId,
    });

    const newUser = await ctx.db.get(_id);
    if (!newUser) throw new Error("User creation failed");

    return { user: newUser, wasCreated: true };
  },
});
