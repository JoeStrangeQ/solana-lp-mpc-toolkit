import bs58 from "bs58";

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

// --- Simple helper to restore Uint8Arrays ---
export function toUint8Array(obj: any): Uint8Array {
  if (obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return new Uint8Array(obj);
  if (typeof obj === "object" && obj !== null) {
    return new Uint8Array(Object.values(obj));
  }
  throw new Error("Invalid binary-like field");
}

// --- Convert raw JSON into real Uint8Array-based EncodedSwapQuotes ---
export function parseSwapQuoteJson(raw: any): EncodedSwapQuotes {
  const quotes = Object.fromEntries(
    Object.entries(raw.quotes).map(([provider, route]: [string, any]) => [
      provider,
      {
        ...route,
        steps: route.steps.map((s: any) => ({
          ...s,
          ammKey: toUint8Array(s.ammKey),
          inputMint: toUint8Array(s.inputMint),
          outputMint: toUint8Array(s.outputMint),
          feeMint: s.feeMint ? toUint8Array(s.feeMint) : undefined,
        })),
        instructions: route.instructions.map((ix: any) => ({
          ...ix,
          p: toUint8Array(ix.p),
          a: ix.a.map((acc: any) => ({
            ...acc,
            p: toUint8Array(acc.p),
          })),
          d: toUint8Array(ix.d),
        })),
        addressLookupTables: route.addressLookupTables.map(toUint8Array),
      },
    ])
  );

  return {
    id: raw.id,
    inputMint: toUint8Array(raw.inputMint),
    outputMint: toUint8Array(raw.outputMint),
    swapMode: raw.swapMode,
    amount: raw.amount,
    quotes,
  };
}
export function normalizeSwapQuotes(quotes: EncodedSwapQuotes): SwapQuotes {
  return {
    id: quotes.id,
    inputMint: bs58.encode(quotes.inputMint),
    outputMint: bs58.encode(quotes.outputMint),
    swapMode: quotes.swapMode,
    amount: quotes.amount,
    quotes: Object.fromEntries(
      Object.entries(quotes.quotes).map(([provider, route]) => [provider, normalizeSwapRoute(route)])
    ),
  };
}

function normalizeSwapRoute(route: EncodedSwapRoute): SwapRoute {
  return {
    ...route,
    steps: route.steps.map(normalizeStep),
    instructions: route.instructions.map(normalizeInstruction),
    addressLookupTables: route.addressLookupTables.map(bs58.encode),
  };
}

function normalizeStep(step: EncodedRoutePlanStep): RoutePlanStep {
  return {
    ...step,
    ammKey: bs58.encode(step.ammKey),
    inputMint: bs58.encode(step.inputMint),
    outputMint: bs58.encode(step.outputMint),
    feeMint: step.feeMint ? bs58.encode(step.feeMint) : undefined,
  };
}

function normalizeInstruction(ix: EncodedInstruction): Instruction {
  return {
    program: bs58.encode(ix.p),
    accounts: ix.a.map(normalizeAccountMeta),
    data: Buffer.from(ix.d).toString("base64"),
  };
}

function normalizeAccountMeta(acc: EncodedAccountMeta): AccountMeta {
  return {
    pubkey: bs58.encode(acc.p),
    s: acc.s,
    w: acc.w,
  };
}
