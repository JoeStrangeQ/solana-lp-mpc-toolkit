import { v } from "convex/values";
import { parseSwapQuoteJson, normalizeSwapQuotes } from "../helpers/normalizeServerSwapQuote";
import { Address } from "../utils/solana";

const MNM_SERVER_URL = "https://apparitional-noninterdependent-dori.ngrok-free.dev";

export const vQuoteDetails = v.object({
  quoteId: v.string(),
  streamId: v.string(),
});
export async function getServerSwapQuote({
  userId,
  quoteId,
  streamId,
}: {
  userId: string;
  streamId: string;
  quoteId: string;
}) {
  const res = await fetch(
    `${MNM_SERVER_URL}/swap-quote?userId=${encodeURIComponent(userId)}&streamId=${encodeURIComponent(streamId)}&quoteId=${encodeURIComponent(quoteId)}`,
    { headers: { "Content-Type": "application/json" } }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch swap quote (${res.status})`);
  }

  const raw = await res.json();
  const encoded = parseSwapQuoteJson(raw);
  return normalizeSwapQuotes(encoded);
}

export async function getSingleSwapQuote({
  inputMint,
  outputMint,
  rawAmount,
  userAddress,
  slippageBps = 100,
}: {
  userAddress: Address;
  inputMint: Address;
  outputMint: Address;
  rawAmount: number;
  slippageBps?: number;
}) {
  const res = await fetch(
    `${MNM_SERVER_URL}/quote?inputMint=${encodeURIComponent(inputMint)}&outputMint=${encodeURIComponent(outputMint)}&amount=${encodeURIComponent(rawAmount)}&slippageBps=${encodeURIComponent(slippageBps)}&userAddress=${encodeURIComponent(userAddress)}`,
    { headers: { "Content-Type": "application/json" } }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch single swap quote (${res.status})`);
  }

  const raw = await res.json();
  const encoded = parseSwapQuoteJson(raw);
  return normalizeSwapQuotes(encoded);
}
