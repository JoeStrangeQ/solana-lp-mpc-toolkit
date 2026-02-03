/**
 * LP Toolkit Convex Functions
 * CRUD operations for LP positions and operations
 */

import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { vDEXVenue, vLPStrategy, vLPPosition, vLPOperation } from "./schema/lpPositions";

// ============ Position Queries ============

/**
 * Get all positions for a wallet address
 */
export const getPositions = query({
  args: { 
    ownerAddress: v.string(),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { ownerAddress, activeOnly = true } = args;
    
    if (activeOnly) {
      return await ctx.db
        .query("lpPositions")
        .withIndex("by_owner_active", (q) => 
          q.eq("ownerAddress", ownerAddress).eq("isActive", true)
        )
        .collect();
    }
    
    return await ctx.db
      .query("lpPositions")
      .withIndex("by_owner", (q) => q.eq("ownerAddress", ownerAddress))
      .collect();
  },
});

/**
 * Get a specific position by ID
 */
export const getPosition = query({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const positions = await ctx.db
      .query("lpPositions")
      .withIndex("by_position_id", (q) => q.eq("positionId", args.positionId))
      .collect();
    return positions[0] || null;
  },
});

/**
 * Get aggregated stats for a wallet
 */
export const getPortfolioStats = query({
  args: { ownerAddress: v.string() },
  handler: async (ctx, args) => {
    const positions = await ctx.db
      .query("lpPositions")
      .withIndex("by_owner_active", (q) => 
        q.eq("ownerAddress", args.ownerAddress).eq("isActive", true)
      )
      .collect();
    
    const stats = {
      totalPositions: positions.length,
      totalValueUSD: 0,
      totalUnclaimedFeesUSD: 0,
      totalFeesClaimedUSD: 0,
      positionsInRange: 0,
      positionsOutOfRange: 0,
      byVenue: {} as Record<string, { count: number; valueUSD: number }>,
    };
    
    for (const pos of positions) {
      stats.totalValueUSD += pos.currentValueUSD;
      stats.totalUnclaimedFeesUSD += pos.unclaimedFeesUSD;
      stats.totalFeesClaimedUSD += pos.totalFeesClaimedUSD;
      
      if (pos.inRange) {
        stats.positionsInRange++;
      } else {
        stats.positionsOutOfRange++;
      }
      
      if (!stats.byVenue[pos.venue]) {
        stats.byVenue[pos.venue] = { count: 0, valueUSD: 0 };
      }
      stats.byVenue[pos.venue].count++;
      stats.byVenue[pos.venue].valueUSD += pos.currentValueUSD;
    }
    
    return stats;
  },
});

// ============ Position Mutations ============

/**
 * Create a new LP position record
 */
export const createPosition = mutation({
  args: {
    ownerAddress: v.string(),
    agentId: v.optional(v.string()),
    venue: vDEXVenue,
    positionId: v.string(),
    poolAddress: v.string(),
    poolName: v.string(),
    tokenA: v.object({
      mint: v.string(),
      symbol: v.string(),
      amount: v.string(),
      decimals: v.number(),
    }),
    tokenB: v.object({
      mint: v.string(),
      symbol: v.string(),
      amount: v.string(),
      decimals: v.number(),
    }),
    depositValueUSD: v.number(),
    priceRange: v.optional(v.object({
      lower: v.number(),
      upper: v.number(),
    })),
    strategy: v.optional(vLPStrategy),
    isPrivate: v.optional(v.boolean()),
    encryptedData: v.optional(v.string()),
    publicKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const positionId = await ctx.db.insert("lpPositions", {
      ownerAddress: args.ownerAddress,
      agentId: args.agentId,
      venue: args.venue,
      positionId: args.positionId,
      poolAddress: args.poolAddress,
      poolName: args.poolName,
      tokenA: args.tokenA,
      tokenB: args.tokenB,
      depositValueUSD: args.depositValueUSD,
      currentValueUSD: args.depositValueUSD,
      lastValueUpdate: now,
      unclaimedFeesA: "0",
      unclaimedFeesB: "0",
      unclaimedFeesUSD: 0,
      totalFeesClaimedUSD: 0,
      priceRange: args.priceRange,
      inRange: true,
      strategy: args.strategy,
      createdAt: now,
      isActive: true,
      isPrivate: args.isPrivate || false,
      encryptedData: args.encryptedData,
      publicKey: args.publicKey,
    });
    
    return positionId;
  },
});

/**
 * Update position values (called periodically)
 */
export const updatePositionValue = mutation({
  args: {
    positionId: v.string(),
    currentValueUSD: v.number(),
    unclaimedFeesA: v.string(),
    unclaimedFeesB: v.string(),
    unclaimedFeesUSD: v.number(),
    inRange: v.boolean(),
  },
  handler: async (ctx, args) => {
    const positions = await ctx.db
      .query("lpPositions")
      .withIndex("by_position_id", (q) => q.eq("positionId", args.positionId))
      .collect();
    
    const position = positions[0];
    if (!position) {
      throw new Error(`Position not found: ${args.positionId}`);
    }
    
    await ctx.db.patch(position._id, {
      currentValueUSD: args.currentValueUSD,
      unclaimedFeesA: args.unclaimedFeesA,
      unclaimedFeesB: args.unclaimedFeesB,
      unclaimedFeesUSD: args.unclaimedFeesUSD,
      inRange: args.inRange,
      lastValueUpdate: Date.now(),
    });
  },
});

/**
 * Close a position
 */
export const closePosition = mutation({
  args: {
    positionId: v.string(),
    finalValueUSD: v.number(),
    feesClaimedUSD: v.number(),
  },
  handler: async (ctx, args) => {
    const positions = await ctx.db
      .query("lpPositions")
      .withIndex("by_position_id", (q) => q.eq("positionId", args.positionId))
      .collect();
    
    const position = positions[0];
    if (!position) {
      throw new Error(`Position not found: ${args.positionId}`);
    }
    
    await ctx.db.patch(position._id, {
      currentValueUSD: args.finalValueUSD,
      totalFeesClaimedUSD: position.totalFeesClaimedUSD + args.feesClaimedUSD,
      unclaimedFeesUSD: 0,
      unclaimedFeesA: "0",
      unclaimedFeesB: "0",
      closedAt: Date.now(),
      isActive: false,
    });
  },
});

/**
 * Record fees claimed
 */
export const recordFeesClaimed = mutation({
  args: {
    positionId: v.string(),
    feesClaimedUSD: v.number(),
  },
  handler: async (ctx, args) => {
    const positions = await ctx.db
      .query("lpPositions")
      .withIndex("by_position_id", (q) => q.eq("positionId", args.positionId))
      .collect();
    
    const position = positions[0];
    if (!position) {
      throw new Error(`Position not found: ${args.positionId}`);
    }
    
    await ctx.db.patch(position._id, {
      totalFeesClaimedUSD: position.totalFeesClaimedUSD + args.feesClaimedUSD,
      unclaimedFeesUSD: 0,
      unclaimedFeesA: "0",
      unclaimedFeesB: "0",
    });
  },
});

// ============ Operation Logging ============

/**
 * Log an LP operation
 */
export const logOperation = mutation({
  args: {
    ownerAddress: v.string(),
    positionId: v.optional(v.string()),
    operation: v.union(
      v.literal("add_liquidity"),
      v.literal("remove_liquidity"),
      v.literal("claim_fees"),
      v.literal("rebalance")
    ),
    venue: vDEXVenue,
    poolAddress: v.string(),
    poolName: v.string(),
    txSignature: v.optional(v.string()),
    amountUSD: v.number(),
    protocolFeePaid: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("lpOperations", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

/**
 * Update operation status
 */
export const updateOperationStatus = mutation({
  args: {
    operationId: v.id("lpOperations"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed")
    ),
    txSignature: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.operationId, {
      status: args.status,
      txSignature: args.txSignature,
      errorMessage: args.errorMessage,
    });
  },
});

/**
 * Get recent operations for a wallet
 */
export const getOperations = query({
  args: { 
    ownerAddress: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { ownerAddress, limit = 20 } = args;
    
    return await ctx.db
      .query("lpOperations")
      .withIndex("by_owner", (q) => q.eq("ownerAddress", ownerAddress))
      .order("desc")
      .take(limit);
  },
});
