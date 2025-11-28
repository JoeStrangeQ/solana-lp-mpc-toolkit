import { z } from "zod";
import { Address, zAddress } from "../utils/solana";
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
  }));
const JupQuoteResponseZ = z.object({
  inputMint: z.string(),
  inAmount: z.string(),
  outputMint: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  swapMode: z.enum(["ExactIn", "ExactOut"]),
  slippageBps: z.number(),
  platformFee: z.nullable(z.any()),
  priceImpactPct: z.string(),
  routePlan: z.array(
    z.object({
      swapInfo: z.object({
        ammKey: z.string(),
        label: z.string(),
        inputMint: z.string(),
        outputMint: z.string(),
        inAmount: z.string(),
        outAmount: z.string(),
        feeAmount: z.string(),
        feeMint: z.string(),
      }),
      percent: z.number(),
    })
  ),
  contextSlot: z.number(),
  timeTaken: z.number(),
});

const AccountZ = z.object({
  pubkey: z.string(),
  isSigner: z.boolean(),
  isWritable: z.boolean(),
});

const InstructionZ = z.object({
  programId: z.string(),
  accounts: z.array(AccountZ),
  data: z.string(),
});

export const JupiterSwapInstructionsResponseZ = z.object({
  otherInstructions: z.array(InstructionZ),

  computeBudgetInstructions: z.array(InstructionZ),

  setupInstructions: z.array(InstructionZ),

  swapInstruction: InstructionZ,

  addressLookupTableAddresses: z.array(z.string()),

  cleanupInstruction: InstructionZ.optional(),
});

export type TokenMetadata = z.infer<typeof TokenMetadataZ>;
export type JupTokenPrices = z.infer<typeof JupTokenPriceZ>;
export type JupQuoteResponse = z.infer<typeof JupQuoteResponseZ>;
export type JupiterSwapInstructionsResponse = z.infer<typeof JupiterSwapInstructionsResponseZ>;

export async function fetchTokensMetadata({ mints }: { mints: string[] }) {
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

  return Object.fromEntries(parsed.map((t) => [t.address, t]));
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

export async function getJupSwapQuote({
  inputAmount,
  inputMint,
  outputMint,
  slippageBps,
}: {
  inputMint: Address;
  outputMint: Address;
  inputAmount: number;
  slippageBps: number;
}) {
  if (inputMint === outputMint || inputAmount === 0) {
    throw new Error(`Can't get swap quote for the input and output mint`);
  }

  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JUPITER_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`jupiter /quote error: ${response.status}: ${await response.text()}`);
  }

  const quoteResponse = await response.json();
  return JupQuoteResponseZ.parse(quoteResponse);
}

export async function getJupSwapInstructions({
  userAddress,
  quote,
  options,
}: {
  userAddress: Address;
  quote: JupQuoteResponse;
  options?: {
    wrapAndUnwrapSol?: boolean;
    skipUserAccountsRpcCalls?: boolean;
    priorityLevelWithMaxLamports?: {
      priorityLevel: "medium" | "high" | "veryHigh";
      maxLamports: number;
      global?: boolean;
    };
  };
}) {
  const body: Record<string, any> = {
    userPublicKey: userAddress,
    quoteResponse: quote,
  };

  if (options?.wrapAndUnwrapSol) {
    body.wrapAndUnwrapSol = options.wrapAndUnwrapSol;
  }

  if (options?.skipUserAccountsRpcCalls) {
    body.skipUserAccountsRpcCalls = options.skipUserAccountsRpcCalls;
  }

  if (options?.priorityLevelWithMaxLamports) {
    body.prioritizationFeeLamports = {
      priorityLevelWithMaxLamports: {
        priorityLevel: options.priorityLevelWithMaxLamports.priorityLevel,
        maxLamports: options.priorityLevelWithMaxLamports.maxLamports,
        ...(options.priorityLevelWithMaxLamports.global !== undefined && {
          global: options.priorityLevelWithMaxLamports.global,
        }),
      },
    };
  }

  const response = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JUPITER_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`jupiter /swap instructions error: ${response.status}: ${await response.text()}`);
  }

  const res = await response.json();
  return JupiterSwapInstructionsResponseZ.parse(res);
}
