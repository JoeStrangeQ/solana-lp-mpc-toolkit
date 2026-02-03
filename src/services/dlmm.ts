import z from "zod";
import { Address, zAddress } from "../../convex/utils/solana";
export const METEORA_DLMM_API_URL = "https://dlmm-api.meteora.ag";

export const zMeteoraPoolTimeframes = z.object({
  min_30: z.number(),
  hour_1: z.number(),
  hour_2: z.number(),
  hour_4: z.number(),
  hour_12: z.number(),
  hour_24: z.number(),
});
const zMeteoraDlmmPool = z
  .object({
    address: zAddress,
    name: z.string(),
    apy: z.number(),
    apr: z.number(),
    mint_x: zAddress,
    mint_y: zAddress,
    bin_step: z.number(),
    base_fee_percentage: z.string(),
    max_fee_percentage: z.string(),
    current_price: z.number(),
    liquidity: z.string(), // TVL
    fees_24h: z.number(),
    trade_volume_24h: z.number(),
    fees: zMeteoraPoolTimeframes,
    fee_tvl_ratio: zMeteoraPoolTimeframes,
    volume: zMeteoraPoolTimeframes,
    reserve_x_amount: z.number(),
    reserve_y_amount: z.number(),
    is_blacklisted: z.boolean(), //TODO: warn the user if true
  })
  .transform((input) => ({
    ...input,
    base_fee_percentage: parseFloat(input.base_fee_percentage),
    max_fee_percentage: parseFloat(input.max_fee_percentage),
    liquidity: parseFloat(input.liquidity),
  }));

const zMeteoraDlmmPoolsWithPaginationResponse = z.object({
  pairs: z.array(zMeteoraDlmmPool),
  total: z.number(),
});
export type MeteoraPoolTimeframes = z.infer<typeof zMeteoraPoolTimeframes>;
export type MeteoraDlmmPool = z.infer<typeof zMeteoraDlmmPool>;

export async function getMeteoraDlmmPool({
  poolAddress,
}: {
  poolAddress: Address;
}) {
  const response = await fetch(`${METEORA_DLMM_API_URL}/pair/${poolAddress}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch pool ${poolAddress}: ${response.ok}`);
  }

  const data = await response.json();
  return zMeteoraDlmmPool.parse(data);
}

export async function getMeteoraPoolsWithPagination({
  page,
  search = "",
  includeTokenMints,
  limit = 30,
}: {
  page: number;
  search?: string;
  includeTokenMints?: Address[];
  limit?: number;
}) {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    // sort_key: 'tvl',
  });

  if (search.trim()) {
    params.append("search_term", search.trim());
  }

  if (includeTokenMints && includeTokenMints?.length !== 0) {
    params.append("include_token_mints", includeTokenMints.join(","));
  }

  const response = await fetch(
    `${METEORA_DLMM_API_URL}/pair/all_with_pagination?${params}`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch pool with pagination");
  }

  const data = await response.json();
  return zMeteoraDlmmPoolsWithPaginationResponse.parse(data);
}
