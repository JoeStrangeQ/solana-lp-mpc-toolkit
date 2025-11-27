import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { useSwapQuote } from "~/states/swap";
import { Address, toAddress } from "../../convex/utils/solana";
import { MnMSuspense } from "~/components/MnMSuspense";
import { Skeleton } from "~/components/ui/Skeleton";
import { LabelValueRow } from "~/components/ui/labelValueRow";
import { SwapQuotes } from "~/services/mnmServer/types";
import { useToken, useTokenPrice } from "~/states/tokens";
import { rawAmountToAmount } from "../../convex/utils/amounts";
import { formatTokenAmount, formatUsdValue } from "~/utils/numberFormats";
import { TokenIcon } from "~/components/TokenIcon";
import { Row } from "~/components/ui/Row";
import { ArrowLeftRight, ArrowRight, Route } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useBinsAroundActiveBin } from "~/states/dlmm";

export default function Home() {
  const [quoteOn, setQuoteOn] = useState(false);

  const [elapsedMs, setElapsedMs] = useState<number | null>(null); // ms duration
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  // const removeLiquidity = useAction(api.actions.dlmmPosition.removeLiquidityV2.removeLiquidity);
  const removeLiquidity = useAction(api.actions.dlmmPosition.removeLiquidityV2.removeLiquidity);

  async function handleRemove() {
    setStatus("loading");
    setElapsedMs(null);

    const start = performance.now();

    try {
      const res = await removeLiquidity({
        percentageToWithdraw: 100,
        trigger: "manual",
        positionPubkey: "4GFgXypcGQC4MMZNewnNXvP4T2nYcv3rNj3ugaCYhJz7",
      });

      const end = performance.now();
      setElapsedMs(Math.round(end - start));

      if (res?.status === "success") {
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch (err) {
      const end = performance.now();
      setElapsedMs(Math.round(end - start));
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col items-center justify-start pt-12 ">
      <div className="text-text text-center mb-2">
        You going to open a SOL/USDC position on a 4 Bin-step pool , your deposit is 0.007 SOL...
      </div>

      <Button className="py-2" variant="neutral" onClick={() => setQuoteOn(!quoteOn)}>
        {quoteOn ? "Stop Quoting" : "Get Quotes"}
      </Button>

      {quoteOn && (
        <MnMSuspense fallback={<></>}>
          <SwapQuotesDisplay />
        </MnMSuspense>
      )}

      <Button variant="liquidPrimary" onClick={handleRemove}>
        {status === "loading" ? "Closing..." : "Close position"}
      </Button>

      {/* Status Display */}
      {elapsedMs !== null && status === "success" && (
        <div className="text-green mt-4">Closed position successfully in {elapsedMs}ms</div>
      )}

      {elapsedMs !== null && status === "error" && <div className="text-red mt-4">Failed after {elapsedMs}ms</div>}
    </div>
  );
}

function SwapQuotesDisplay() {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null); // ms duration

  const createPosition = useAction(api.actions.dlmmPosition.createPositionV2.createPosition);

  const inputMint = "So11111111111111111111111111111111111111112" as Address;
  const tokenX = "So11111111111111111111111111111111111111112" as Address;
  const tokenY = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
  const poolAddress = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6" as Address;
  const needSwapX = inputMint !== tokenX;
  const needSwapY = inputMint !== tokenY;

  const xInDepositRaw = 2_000_000;
  const yInDepositRaw = 2_000_000;

  const { swapQuote: xSwapQuote, streamId: xStreamId } = useSwapQuote({
    inputMint,
    outputMint: tokenX,
    inputRawAmount: xInDepositRaw,
  });
  const { swapQuote: ySwapQuote, streamId: yStreamId } = useSwapQuote({
    inputMint,
    outputMint: tokenY,
    inputRawAmount: yInDepositRaw,
  });

  const { initialBins } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: 67,
    numberOfBinsToTheRight: 67,
  });

  initialBins[0].binId;

  const lowerBin = initialBins[0];
  const upperBin = initialBins[initialBins.length - 1];

  const quoteDetails = [
    xSwapQuote && { quoteId: xSwapQuote.id, streamId: xStreamId },
    ySwapQuote && { quoteId: ySwapQuote.id, streamId: yStreamId },
  ].filter(Boolean) as { quoteId: string; streamId: string }[];

  const [error, setError] = useState<string | null>(null);
  const [success, setIsSuccess] = useState(false);

  return (
    <div className="flex flex-col">
      {needSwapX && !xSwapQuote ? (
        <QuoteDetailsSkeleton />
      ) : (
        xSwapQuote && (
          <MnMSuspense fallback={<QuoteDetailsSkeleton />}>
            <QuoteDetails swapQuote={xSwapQuote} txIndex={1} />
          </MnMSuspense>
        )
      )}
      {needSwapX && <div className="w-full h-px bg-white/10 my-3" />}

      {needSwapY && !ySwapQuote ? (
        <QuoteDetailsSkeleton />
      ) : (
        ySwapQuote && (
          <MnMSuspense fallback={<QuoteDetailsSkeleton />}>
            <QuoteDetails swapQuote={ySwapQuote} txIndex={needSwapX ? 2 : 1} />
          </MnMSuspense>
        )
      )}

      <Button
        variant="liquidPrimary"
        onClick={async () => {
          const start = performance.now();
          const res = await createPosition({
            quoteDetails,
            poolAddress,
            autoCompoundSplit: 0.5,
            minBin: {
              id: lowerBin.binId,
              price: parseFloat(lowerBin.pricePerToken),
            },
            maxBin: {
              id: upperBin.binId,
              price: parseFloat(upperBin.pricePerToken),
            },
            strategyTypeString: "Spot",
            collateral: {
              amount: 0.004,
              decimals: 9,
              mint: inputMint,
            },
            tokenX: {
              mint: tokenX,
              decimals: 9,
              split: 0.5,
            },
            tokenY: {
              mint: tokenY,
              decimals: 6,
              split: 0.5,
            },
          });

          const end = performance.now();
          setElapsedMs(Math.round(end - start));

          if (res.status === "failed") {
            setError(res.errorMsg);
          } else {
            setIsSuccess(true);
          }
        }}
      >
        Create position
      </Button>
      {error && <div className="text-red">{error}</div>}
      {success && (
        <div className="text-green">
          {"success"} {elapsedMs}ms
        </div>
      )}
    </div>
  );
}

function QuoteDetailsSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="mb-3 w-32 h-7" />
      {/* labels */}
      <div className="flex flex-col gap-2">
        <LabelValueRow label={`Receives`} isLoading value={<></>} />

        <LabelValueRow label={`Route`} isLoading value={<></>} />

        <LabelValueRow label="Rate" isLoading value={<></>} />
      </div>
    </div>
  );
}

function QuoteDetails({ swapQuote, txIndex }: { swapQuote: SwapQuotes; txIndex: number }) {
  const providers = Object.keys(swapQuote.quotes);
  if (providers.length === 0) return null;

  const provider = providers[0];
  const quote = swapQuote.quotes[provider];
  const { outAmount, inAmount } = quote;
  const [isInverseRate, setIsInverseRate] = useState(false);
  const inputToken = useToken({ mint: toAddress(swapQuote.inputMint) });
  const outputToken = useToken({ mint: toAddress(swapQuote.outputMint) });

  const outTokenPrice = useTokenPrice({ mint: outputToken.address });

  const inUiAmount = rawAmountToAmount(inAmount, inputToken.decimals);
  const outUiAmount = rawAmountToAmount(outAmount, outputToken.decimals);

  const rateValue = outUiAmount / inUiAmount;
  const inverseRateValue = inUiAmount / outUiAmount;

  const rate = `1 ${inputToken.symbol} ≈ ${formatTokenAmount(rateValue, undefined)} ${outputToken.symbol}`;

  const inverseRate = `1 ${outputToken.symbol} ≈ ${formatTokenAmount(
    inverseRateValue,
    undefined
  )} ${inputToken.symbol}`;
  return (
    <div className="flex flex-col">
      <Row justify="start" className="items-center gap-3 mb-3">
        {/* Index */}
        <div className="text-textSecondary text-sm">#{txIndex}</div>

        {/* Token pair section */}
        <div className="flex flex-row items-center">
          {/* Input token */}
          <div className="flex flex-row items-center gap-1.5">
            <TokenIcon className="w-7 h-7 rounded-full" logoURI={inputToken.logoURI} />
            <div className="text-text">
              {formatTokenAmount(inUiAmount, inputToken.symbol, {
                minimumFractionDigits: 4,
              })}
            </div>
          </div>

          <ArrowRight className="h-4 w-4 text-text mx-2" />

          {/* Output token */}
          <div className="flex flex-row items-center gap-1.5">
            <TokenIcon className="w-7 h-7 rounded-full" logoURI={outputToken.logoURI} />
            <div className="text-text">
              {formatTokenAmount(outUiAmount, outputToken.symbol, {
                minimumFractionDigits: 4,
              })}
            </div>
          </div>
        </div>
      </Row>

      {/* labels */}
      <div className="flex flex-col gap-0.5">
        <LabelValueRow
          label={`Receives`}
          value={formatUsdValue(outTokenPrice * outUiAmount, {
            minimumFractionDigits: 4,
          })}
        />

        <LabelValueRow
          label={`Route`}
          value={
            <Row className="gap-1">
              <div className="flex flex-row items-center px-1 py-0.5 rounded-md bg-white/5 border border-white/10 gap-0.5">
                <div className="text-text text-[10px]">{quote.steps.length}</div>
                <Route className="h-2.5 w-2.5" />
              </div>
              <div className="text-textSecondary text-[10px]">Via</div>
              <div className="text-text text-xs"> {quote.steps.map((step) => step.label).join(", ")}</div>
            </Row>
          }
        />

        <LabelValueRow
          label="Rate"
          value={
            <Row
              onClick={() => setIsInverseRate(!isInverseRate)}
              className="
        gap-1 cursor-pointer select-none
        transition-all duration-150
        hover:underline
        active:scale-95
      "
            >
              {isInverseRate ? inverseRate : rate}
              <ArrowLeftRight className="w-3 h-3" />
            </Row>
          }
        />
      </div>
    </div>
  );
}
