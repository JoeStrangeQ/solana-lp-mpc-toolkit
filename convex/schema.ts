import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import { vPosition } from "./schema/positions";
import { vActivity } from "./schema/activities";
import { vOrder } from "./schema/limitOrders";
import { vLPPosition, vLPOperation } from "./schema/lpPositions";

export const vLinkedAccountType = v.union(
  v.literal("email"),
  v.literal("google"),
  v.literal("discord"),
  v.literal("twitter"),
  v.literal("external wallet"),
);
export type LinkedAccountType = Infer<typeof vLinkedAccountType>;

export const vUser = v.object({
  address: v.string(),
  privyUserId: v.string(),
});
export type User = Infer<typeof vUser>;

export default defineSchema({
  users: defineTable(vUser)
    .index("by_address", ["address"])
    .index("by_privyUserId", ["privyUserId"]),
  activities: defineTable(vActivity)
    .index("by_user", ["userId"])
    .index("by_position_type", ["relatedPositionPubkey", "type"])
    .index("by_user_type", ["userId", "type"]),
  positions: defineTable(vPosition)
    .index("by_user", ["userId"])
    .index("by_position_pk", ["positionPubkey"])
    .index("by_active", ["userId", "isActive"]),
  orders: defineTable(vOrder)
    .index("by_market_direction_price", ["market", "direction", "triggerPrice"])
    .index("by_position_pk", ["positionPubkey"])
    .index("by_user", ["userId"]),

  // LP Toolkit tables
  lpPositions: defineTable(vLPPosition)
    .index("by_owner", ["ownerAddress"])
    .index("by_owner_active", ["ownerAddress", "isActive"])
    .index("by_venue", ["venue"])
    .index("by_position_id", ["positionId"])
    .index("by_pool", ["poolAddress"]),

  lpOperations: defineTable(vLPOperation)
    .index("by_owner", ["ownerAddress"])
    .index("by_position", ["positionId"])
    .index("by_status", ["status"])
    .index("by_timestamp", ["timestamp"]),
});
