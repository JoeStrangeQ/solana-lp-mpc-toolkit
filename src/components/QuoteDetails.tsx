import { ArrowRight, Route, ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { SwapQuotes } from "~/services/mnmServer/types";
import { useToken, useTokenPrice } from "~/states/tokens";
import { formatTokenAmount, formatUsdValue } from "~/utils/numberFormats";
import { rawAmountToAmount } from "../../convex/utils/amounts";
import { toAddress } from "../../convex/utils/solana";
import { TokenIcon } from "./TokenIcon";
import { LabelValue } from "./ui/labelValueRow";
import { Row } from "./ui/Row";
import { Skeleton } from "./ui/Skeleton";

export function QuoteDetails({
  swapQuote,
  txIndex,
}: {
  swapQuote: SwapQuotes;
  txIndex: number;
}) {
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
    undefined,
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
            <TokenIcon
              className="w-7 h-7 rounded-full"
              icon={inputToken.icon}
            />
            <div className="text-text">
              {formatTokenAmount(inUiAmount, inputToken.symbol, {
                minimumFractionDigits: 4,
              })}
            </div>
          </div>

          <ArrowRight className="h-4 w-4 text-text mx-2" />

          {/* Output token */}
          <div className="flex flex-row items-center gap-1.5">
            <TokenIcon
              className="w-7 h-7 rounded-full"
              icon={outputToken.icon}
            />
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
        <LabelValue
          variant="row"
          label={`Receives`}
          value={formatUsdValue(outTokenPrice * outUiAmount, {
            minimumFractionDigits: 4,
          })}
        />

        <LabelValue
          variant="row"
          label={`Route`}
          value={
            <Row className="gap-1">
              <div className="flex flex-row items-center px-1 py-0.5 rounded-md bg-white/5 border border-white/10 gap-0.5">
                <div className="text-text text-[10px]">
                  {quote.steps.length}
                </div>
                <Route className="h-2.5 w-2.5" />
              </div>
              <div className="text-textSecondary text-[10px]">Via</div>
              <div className="text-text text-xs">
                {" "}
                {quote.steps.map((step) => step.label).join(", ")}
              </div>
            </Row>
          }
        />

        <LabelValue
          variant="row"
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

export function QuoteDetailsSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="mb-3 w-32 h-5" />
      {/* labels */}
      <div className="flex flex-col gap-2">
        <LabelValue variant="row" label={`Receives`} isLoading value={<></>} />

        <LabelValue variant="row" label={`Route`} isLoading value={<></>} />

        <LabelValue variant="row" label="Rate" isLoading value={<></>} />
      </div>
    </div>
  );
}
