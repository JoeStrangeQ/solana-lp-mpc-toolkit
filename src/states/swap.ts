import { useEffect, useState } from "react";
import { v4 as randomUUID } from "uuid";
import { SwapQuotes } from "~/services/mnmServer/types";
import { useConvexUser } from "~/providers/UserStates";
import { Address } from "../../convex/utils/address";
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
  const [streamId] = useState(`${convexUser?._id}:${randomUUID()}`);
  const [swapQuote, setSwapQuote] = useState<SwapQuotes | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (inputMint === outputMint) return;
    let active = true;

    const startQuoteStreaming = async () => {
      try {
        await mnmServer.connect();
        setIsStreaming(true);

        mnmServer.onQuoteUpdate(streamId, (update) => {
          if (!active) return;
          setSwapQuote(update.payload);
        });

        mnmServer.subscribeQuotes({
          inputMint,
          outputMint,
          amount: inputRawAmount,
          streamId,
        });
      } catch (err) {
        console.error("❌ Failed to start quote streaming:", err);
      }
    };

    startQuoteStreaming();

    return () => {
      active = false;
      setIsStreaming(false);
      mnmServer.unsubscribeQuote(streamId);
    };
  }, [inputMint, outputMint, inputRawAmount]);

  return {
    swapQuote,
    streamId,
    isStreaming,
  };
}
