import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

export const vLinkedAccountType = v.union(
  v.literal("email"),
  v.literal("google"),
  v.literal("discord"),
  v.literal("twitter"),
  v.literal("external wallet")
);
export type LinkedAccountType = Infer<typeof vLinkedAccountType>;

export const vUser = v.object({
  address: v.string(),
  privyUserId: v.string(),
});
export type User = Infer<typeof vUser>;

export default defineSchema({
  users: defineTable(vUser).index("by_address", ["address"]).index("by_privyUserId", ["privyUserId"]),
});
