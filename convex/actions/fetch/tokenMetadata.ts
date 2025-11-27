"use node";
import { v } from "convex/values";
import { components, internal } from "../../_generated/api";
import { action, internalAction } from "../../_generated/server";
import { fetchTokensMetadata, TokenMetadata } from "../../services/jupiter";
import { MS_1M } from "../../utils/timeframe";
import { ActionCache } from "@convex-dev/action-cache";

const tokenMetadataCache = new ActionCache(components.actionCache, {
  action: internal.actions.fetch.tokenMetadata.getTokenMetadataInternalAction,
  ttl: MS_1M * 120, //TODO: Change when adding token data as the data needs to update more freq
});

export const getTokenMetadataAction = action({
  args: { mint: v.string() },
  handler: async (ctx, { mint }): Promise<TokenMetadata> => {
    return await tokenMetadataCache.fetch(ctx, { mint });
  },
});

export const getTokenMetadataInternalAction = internalAction({
  args: {
    mint: v.string(),
  },
  handler: async (_ctx, { mint }) => {
    const metadata = await fetchTokensMetadata({ mints: [mint] });
    return Object.values(metadata)[0];
  },
});
