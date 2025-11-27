"use node";
import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { getJupiterTokenPrices } from "../../services/jupiter";
import { toAddress } from "../../utils/solana";
import { ActionCache } from "@convex-dev/action-cache";
import { components, internal } from "../../_generated/api";
import { MS_1M } from "../../utils/timeframe";

const tokenPriceCache = new ActionCache(components.actionCache, {
  action: internal.actions.fetch.tokenPrices.getJupiterTokenPriceInternalAction,
  ttl: MS_1M,
});

export const getJupiterTokenPriceAction = action({
  args: {
    mint: v.string(),
  },
  handler: async (ctx, { mint }): Promise<number> => {
    return await tokenPriceCache.fetch(ctx, { mint });
  },
});

export const getJupiterTokenPriceInternalAction = internalAction({
  args: { mint: v.string() },
  handler: async (_ctx, { mint }) => {
    const address = toAddress(mint);
    const priceMap = await getJupiterTokenPrices({ mints: [address] });
    const price = priceMap[address];

    if (!price) {
      throw new Error(`No price found for ${address}`);
    }

    return price.usdPrice;
  },
});
