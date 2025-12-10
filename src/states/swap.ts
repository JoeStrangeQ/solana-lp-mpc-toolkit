import { useEffect, useState } from "react";
import { v4 as randomUUID } from "uuid";
import { SwapQuotes } from "~/services/mnmServer/types";
import { useConvexUser } from "~/providers/UserStates";
import { Address } from "../../convex/utils/solana";
import { useMnMServerClient } from "./useMnMServer";

export function useSwapQuote({
  inputMint,
  inputRawAmount,
  outputMint,
}: {
  inputMint: Address;
  outputMint: Address;
  inputRawAmount: number;
}) {
  const { convexUser } = useConvexUser();
  const mnmServer = useMnMServerClient();

  const [streamKey] = useState(`${convexUser?._id}:${randomUUID()}`);
  const [swapQuote, setSwapQuote] = useState<SwapQuotes | null>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inputMint || !outputMint || inputMint === outputMint || inputRawAmount <= 0) return;
    if (mnmServer.isError) {
      setStatus("error");
      setError("Unknown error");
    }
  }, [mnmServer.isError]);
  useEffect(() => {
    if (!inputMint || !outputMint || inputMint === outputMint || inputRawAmount <= 0) return;

    let active = true;
    setStatus("loading");
    setError(null);
    setSwapQuote(null);

    const startQuoteStreaming = async () => {
      try {
        await mnmServer.connect();

        // ✅ listen for server errors
        mnmServer.onError((msg) => {
          console.log("Error found", msg);
          if (!active) return;
          setStatus("error");
          setError(msg);
        });

        mnmServer.onQuoteUpdate(streamKey, (update) => {
          if (!active) return;
          setSwapQuote(update.payload);
          setStatus("success");
        });

        mnmServer.subscribeQuotes({
          inputMint,
          outputMint,
          amount: inputRawAmount,
          streamKey,
        });
      } catch (err) {
        console.error("Failed to start quote streaming:", err);
        setStatus("error");
        setError("Failed to connect to quote server");
      }
    };

    startQuoteStreaming();

    return () => {
      active = false;
      mnmServer.unsubscribeQuote(streamKey);
    };
  }, [inputMint, outputMint, inputRawAmount]);

  return {
    swapQuote,
    streamKey,
    status,
    isError: status === "error",
    isLoading: status === "loading",
    error,
  };
}
