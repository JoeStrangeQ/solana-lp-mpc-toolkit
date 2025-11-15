"use node";
import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { getJupiterTokenPrices, JupTokenPrices } from "../../services/jupiter";
import { zAddress } from "../../utils/address";
import z from "zod";
import { ActionCache } from "@convex-dev/action-cache";
import { components, internal } from "../../_generated/api";
import { MS_1M } from "../../utils/timeframe";

const tokenPricesCache = new ActionCache(components.actionCache, {
  action: internal.actions.fetch.tokenPrices.getJupiterTokenPricesInternalAction,
  ttl: MS_1M,
});

export const getJupiterTokenPricesAction = action({
  args: {
    mints: v.array(v.string()),
  },
  handler: async (ctx, { mints }): Promise<JupTokenPrices> => {
    return await tokenPricesCache.fetch(ctx, { mints });
  },
});

export const getJupiterTokenPricesInternalAction = internalAction({
  args: {
    mints: v.array(v.string()),
  },
  handler: async (_ctx, { mints }) => {
    const parsedMints = z.array(zAddress).parse(mints);
    const prices = await getJupiterTokenPrices({ mints: parsedMints });
    return prices;
  },
});
