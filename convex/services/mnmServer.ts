import { v } from "convex/values";
import { parseSwapQuoteJson, normalizeSwapQuotes } from "../helpers/normalizeServerSwapQuote";

const MNM_SERVER_URL = "https://apparitional-noninterdependent-dori.ngrok-free.dev";

export const QuoteDetails = v.object({
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
