import z from "zod";

export interface MnMServerClientOptions {
  serverUrl: string;
  privyToken: string;
  apiKey: string;
  debug?: boolean;
}

export const HelloMessageZ = z.object({
  type: z.literal("hello"),
  userAddress: z.string(),
});

export const ErrorMessageZ = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const EncodedQuoteUpdateMessageZ = z.object({
  type: z.literal("quote_update"),
  payload: z.custom<EncodedSwapQuotes>(),
  streamId: z.string(),
});
export type EncodedQuoteUpdateMessage = z.infer<typeof EncodedQuoteUpdateMessageZ>;

export type QuoteUpdateMessage = Omit<EncodedQuoteUpdateMessage, "payload"> & {
  payload: SwapQuotes;
};
export const ServerMessageZ = z.discriminatedUnion("type", [HelloMessageZ, ErrorMessageZ, EncodedQuoteUpdateMessageZ]);
export type ServerMessage = z.infer<typeof ServerMessageZ>;

export const SubscribeQuotesPayloadZ = z.object({
  inputMint: z.string().min(32), // base58 pubkey
  outputMint: z.string().min(32),
  amount: z.number().positive(),
  streamId: z.string(),
});
export type SubscribeQuotesPayload = z.infer<typeof SubscribeQuotesPayloadZ>;

export const UnsubscribeQuotePayloadZ = z.object({
  streamId: z.string(),
});
export type UnsubscribeQuotePayload = z.infer<typeof UnsubscribeQuotePayloadZ>;

export const ClientMessageZ = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe_quotes"),
    payload: SubscribeQuotesPayloadZ,
  }),
  z.object({
    type: z.literal("unsubscribe_quote"),
    payload: UnsubscribeQuotePayloadZ,
  }),
  z.object({
    type: z.literal("unsubscribe_all_quotes"),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageZ>;

///Titan types ////

// ----------- Common types -----------
type Pubkey = Uint8Array;
export interface EncodedAccountMeta {
  p: Pubkey;
  s: boolean;
  w: boolean;
}
export interface EncodedInstruction {
  p: Pubkey;
  a: EncodedAccountMeta[];
  d: Uint8Array;
}
enum SwapMode {
  ExactIn = "ExactIn",
  ExactOut = "ExactOut",
}

// ----------- Stream Data -----------

export interface EncodedRoutePlanStep {
  // Which AMM is being executed on at this step.
  ammKey: Uint8Array;
  // Label for the protocol being used.
  //
  // Examples: "Raydium AMM", "Phoenix", etc.
  label: string;
  // Address of the input mint for this swap.
  inputMint: Uint8Array;
  // Address of the output mint for this swap.
  outputMint: Uint8Array;
  // How many input tokens are expected to go through this step.
  inAmount: number;
  // How many output tokens are expected to come out of this step.
  outAmount: number;
  // What what proportion, in parts per billion, of the order flow is allocated
  // to flow through this pool.
  allocPpb: number;
  // Address of the mint in which the fee is charged.
  feeMint?: Uint8Array;
  // The amount of tokens charged as a fee for this swap.
  feeAmount?: number;
  // Context slot for the pool data, if known.
  contextSlot?: number;
}

interface PlatformFee {
  /// Amount of tokens taken as a fee.
  amount: number;
  /// Fee percentage, in basis points.
  fee_bps: number;
}

export interface EncodedSwapRoute {
  // How many input tokens are expected to go through this route.
  inAmount: number;
  // How many output tokens are expected to come out of this route.
  outAmount: number;
  // Amount of slippage encurred, in basis points.
  slippageBps: number;
  // Platform fee information; if such a fee is charged by the provider.
  platformFee?: PlatformFee;
  // Topologically ordered DAG containing the steps that comprise this route.
  steps: EncodedRoutePlanStep[];
  // Instructions needed to execute the route.
  instructions: EncodedInstruction[];
  // Address lookup tables necessary to load.
  addressLookupTables: Pubkey[];
  // Context slot for the route provided.
  contextSlot?: number;
  // Amount of time taken to generate the quote in nanoseconds; if known.
  timeTaken?: number;
  // If this route expires by time, the time at which it expires,
  // as a millisecond UNIX timestamp.
  expiresAtMs?: number;
  // If this route expires by slot, the last slot at which the route is valid.
  expiresAfterSlot?: number;
  // The number of compute units this transaction is expected to consume, if known.
  computeUnits?: number;
  // Recommended number of compute units to use for the budget for this route, if known.
  // The number of compute units used by a route can fluctuate based on changes on-chain,
  // so the server will recommend a higher limit that should allow the transaction to execute
  // in the vast majority of cases.
  computeUnitsSafe?: number;
  // Transaction for the user to sign, if instructions not provided.
  transaction?: Uint8Array;
  // Provider-specific reference ID for this quote.
  //
  // Mainly provided by RFQ-based providers such as Pyth Express Relay and Hashflow.
  referenceId?: string;
}

export interface EncodedSwapQuotes {
  // Unique Quote identifier.
  id: string;
  // Address of the input mint for this quote.
  inputMint: Uint8Array;
  // Address of the output mint for this quote.
  outputMint: Uint8Array;
  // What swap mode was used for the quotes.
  swapMode: SwapMode;
  // Amount used for the quotes.
  amount: number;
  // A mapping of a provider identifier to their quoted route.
  quotes: { [key: string]: EncodedSwapRoute };
}

///parsed titan types ///

export interface SwapQuotes {
  id: string;
  inputMint: string;
  outputMint: string;
  swapMode: string;
  amount: number;
  quotes: Record<string, SwapRoute>;
}

export interface SwapRoute extends Omit<EncodedSwapRoute, "steps" | "instructions" | "addressLookupTables"> {
  steps: RoutePlanStep[];
  instructions: Instruction[];
  addressLookupTables: string[];
}

export interface RoutePlanStep extends Omit<EncodedRoutePlanStep, "ammKey" | "inputMint" | "outputMint" | "feeMint"> {
  ammKey: string;
  inputMint: string;
  outputMint: string;
  feeMint?: string;
}

export interface Instruction extends Omit<EncodedInstruction, "p" | "a" | "d"> {
  program: string;
  accounts: AccountMeta[];
  data: string; // base64
}

export interface AccountMeta extends Omit<EncodedAccountMeta, "p"> {
  pubkey: string;
}
