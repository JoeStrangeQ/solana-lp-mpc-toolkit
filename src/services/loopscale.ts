import z from "zod";
import { Address } from "../../convex/utils/solana";

const LOOPSCALE_BASE_URL = "https://case.loopscale.com/v1";

const MaxQuoteItemZ = z.object({
  apy: z.number(),
  strategy: z.string(),
  collateralIdentifier: z.string(),
  ltv: z.number(),
  lqt: z.number(),
  amount: z.number(),
});
const OraclePriceInfoZ = z.object({
  oracleAccount: z.string(),
  baseMint: z.string(),
  lastUpdateTime: z.number(),
  uncertainty: z.number(),
  spotPrice: z.number(),
  twapPrice: z.number(),
  marketPrice: z.number().nullable(),
});

export const LoopscaleOraclePricesResponseZ = z.record(z.string(), OraclePriceInfoZ);
export const LoopscaleMaxQuoteResponseZ = z.array(MaxQuoteItemZ);

export type MaxQuoteItem = z.infer<typeof MaxQuoteItemZ>;
export type LoopscaleMaxQuoteResponse = z.infer<typeof LoopscaleMaxQuoteResponseZ>;
export type LoopscaleOraclePricesResponse = z.infer<typeof LoopscaleOraclePricesResponseZ>;

export async function getLoopscaleMaxQuote({
  userAddress,
  collateralMint,
  poolAddress,
  priceOverride,
}: {
  userAddress: Address;
  collateralMint: Address;
  poolAddress: Address;
  priceOverride: number;
}): Promise<LoopscaleMaxQuoteResponse> {
  //TODO: Create more asset data e.g for orca. and receive protocol in the params

  const requestBody = {
    userWallet: userAddress,
    durationType: 0,
    duration: 1,
    principalMint: collateralMint,
    collateralFilter: [
      {
        amount: 0,
        assetData: {
          Spl: {
            mint: poolAddress,
          },
        },
      },
    ],
    priceOverride,
  };

  const response = await fetch(`${LOOPSCALE_BASE_URL}/markets/quote/max`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-wallet": userAddress,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Loopscale max quote API error: ${response.status}: ${errorText}`);
  }

  const responseData = await response.json();
  return LoopscaleMaxQuoteResponseZ.parse(responseData);
}

export async function getLoopscaleOraclePrices(): Promise<LoopscaleOraclePricesResponse> {
  const response = await fetch(`${LOOPSCALE_BASE_URL}/markets/prices`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Loopscale oracle prices API error: ${response.status}: ${errorText}`);
  }

  const responseData = await response.json();
  return LoopscaleOraclePricesResponseZ.parse(responseData);
}
