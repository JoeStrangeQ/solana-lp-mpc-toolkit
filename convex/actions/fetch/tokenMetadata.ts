"use node";
import { v } from "convex/values";
import { components, internal } from "../../_generated/api";
import { action, internalAction } from "../../_generated/server";
import { TokenMetadata, TokenMetadataZ } from "../../services/jupiter";
import { MS_1M } from "../../utils/timeframe";
import { ActionCache } from "@convex-dev/action-cache";
import z from "zod";
import { JUPITER_API_KEY } from "../../convexEnv";

const tokenMetadataCache = new ActionCache(components.actionCache, {
  action: internal.actions.fetch.tokenMetadata.getTokensMetadataInternalAction,
  ttl: MS_1M, // one min
});

export const getTokensMetadataAction = action({
  args: { mints: v.array(v.string()) },
  handler: async (ctx, { mints }): Promise<TokenMetadata[]> => {
    return await tokenMetadataCache.fetch(ctx, { mints });
  },
});

export const getTokensMetadataInternalAction = internalAction({
  args: {
    mints: v.array(v.string()),
  },
  handler: async (_ctx, { mints }) => {
    const url = `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mints.join(","))}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": JUPITER_API_KEY,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Jupiter API error: ${response.status}: ${body}`);
    }

    const data = await response.json();
    const parsed = z.array(TokenMetadataZ).parse(data);

    return parsed;
  },
});
