import { z } from "zod";
import { Address, zAddress } from "../utils/address";
import { JUPITER_API_KEY } from "../convexEnv";

const JupTokenPriceZ = z.record(zAddress, z.object({ usdPrice: z.number() }));

const TokenStatsSchemaZ = z
  .object({
    priceChange: z.number(),
    holderChange: z.number(),
    liquidityChange: z.number(),
    volumeChange: z.number(),
    buyVolume: z.number(),
    sellVolume: z.number(),
    buyOrganicVolume: z.number(),
    sellOrganicVolume: z.number(),
    numBuys: z.number(),
    numSells: z.number(),
    numTraders: z.number(),
    numOrganicBuyers: z.number(),
    numNetBuyers: z.number(),
  })
  .partial();

export const TokenMetadataZ = z
  .object({
    id: zAddress, // required
    name: z.string(), // required
    symbol: z.string(), // required
    decimals: z.number().int(), // required
    tokenProgram: z.string(), // required
    organicScore: z.number(), // required
    organicScoreLabel: z.string(), // required

    icon: z.string().url().optional(),
    dev: z.string().optional(),
    circSupply: z.number().optional(),
    totalSupply: z.number().optional(),

    firstPool: z
      .object({
        id: z.string(),
        createdAt: z.string().datetime(),
      })
      .partial()
      .optional(),

    holderCount: z.number().int().optional(),

    audit: z
      .object({
        mintAuthorityDisabled: z.boolean(),
        freezeAuthorityDisabled: z.boolean(),
        topHoldersPercentage: z.number(),
        devBalancePercentage: z.number(),
      })
      .partial()
      .optional(),

    isVerified: z.boolean().optional(),
    cexes: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),

    fdv: z.number().optional(),
    mcap: z.number().optional(),
    usdPrice: z.number().optional(),
    priceBlockId: z.number().optional(),
    liquidity: z.number().optional(),

    stats5m: TokenStatsSchemaZ.optional(),
    stats1h: TokenStatsSchemaZ.optional(),
    stats6h: TokenStatsSchemaZ.optional(),
    stats24h: TokenStatsSchemaZ.optional(),

    ctLikes: z.number().int().optional(),
    smartCtLikes: z.number().int().optional(),

    updatedAt: z.string().optional(),
  })
  .transform((data) => ({
    ...data,
    address: data.id,
    logoURI: data.icon ?? "",
  }));

export type TokenMetadata = z.infer<typeof TokenMetadataZ>;
export type JupTokenPrices = z.infer<typeof JupTokenPriceZ>;
export async function getTokenMetadata({ mint }: { mint: Address }) {
  const response = await fetch(`https://api.jup.ag/tokens/v2/search?query=${mint}`, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JUPITER_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Jupiter /token/${mint} API error: ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  const parsedResponse = z.array(TokenMetadataZ).parse(data);
  if (parsedResponse.length === 0) throw new Error(`Couldn't find token metadata for token mint:${mint}`);

  return parsedResponse[0];
}

export async function getJupiterTokenPrices({ mints }: { mints: Address[] }) {
  const response = await fetch(`https://api.jup.ag/price/v3?ids=${mints.join(",")}`, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JUPITER_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`jupiter /price api error: ${response.status}: ${await response.text()}`);
  }
  const responseData = await response.json();

  const data = JupTokenPriceZ.parse(responseData);
  return data;
}
