import { v } from "convex/values";
import z from "zod";

const AccountMetaV = v.object({
  pubkey: v.string(),
  s: v.boolean(),
  w: v.boolean(),
});

export const TitanSwapInstructionV = v.object({
  program: v.string(),
  accounts: v.array(AccountMetaV),
  data: v.string(), // base64
});

const RoutePlanStepV = v.object({
  label: v.optional(v.string()),
  inputMint: v.string(),
  outputMint: v.string(),
  inAmount: v.string(),
  outAmount: v.string(),
  // any other fields Titan provides for the route step
});

const SwapRouteV = v.object({
  inAmount: v.string(),
  outAmount: v.string(),
  steps: v.array(RoutePlanStepV),
  instructions: v.array(TitanSwapInstructionV),
  addressLookupTables: v.array(v.string()),
});

export const SwapQuotesV = v.object({
  id: v.string(),
  inputMint: v.string(),
  outputMint: v.string(),
  swapMode: v.string(),
  amount: v.number(),
  quotes: v.record(v.string(), SwapRouteV),
});

///zod

const AccountMetaZ = z.object({
  pubkey: z.string(),
  s: z.boolean(),
  w: z.boolean(),
});

const TitanSwapInstructionZ = z.object({
  program: z.string(),
  accounts: z.array(AccountMetaZ),
  data: z.string(), // base64
});

const RoutePlanStepZ = z.object({
  label: z.optional(z.string()),
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  // any other fields Titan prozides for the route step
});

const SwapRouteZ = z.object({
  inAmount: z.string(),
  outAmount: z.string(),
  steps: z.array(RoutePlanStepZ),
  instructions: z.array(TitanSwapInstructionZ),
  addressLookupTables: z.array(z.string()),
});

export const SwapQuotesZ = z.object({
  id: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  swapMode: z.string(),
  amount: z.number(),
  quotes: z.record(z.string(), SwapRouteZ),
});
