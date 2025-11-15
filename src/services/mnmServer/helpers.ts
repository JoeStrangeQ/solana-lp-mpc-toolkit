import bs58 from "bs58";
import {
  AccountMeta,
  EncodedAccountMeta,
  EncodedInstruction,
  EncodedRoutePlanStep,
  EncodedSwapQuotes,
  EncodedSwapRoute,
  Instruction,
  RoutePlanStep,
  SwapQuotes,
  SwapRoute,
} from "./types";

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
