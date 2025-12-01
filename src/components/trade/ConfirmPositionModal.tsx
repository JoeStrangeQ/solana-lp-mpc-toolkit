import { usePool } from "~/states/pools";
import { Address, toAddress, tokensMetadata } from "../../../convex/utils/solana";
import { useToken } from "~/states/tokens";
import { useCreatePositionState } from "./CreatePositionPanel";
import { useSwapQuote } from "~/states/swap";
import { amountToRawAmount } from "../../../convex/utils/amounts";
import { LabelValue } from "../ui/labelValueRow";
import { Row } from "../ui/Row";
import { PoolTokenIcons } from "../TokenIcon";
import { MnMSuspense } from "../MnMSuspense";
import { MeteoraDlmmPool } from "~/services/dlmm";
import { LiquidityShape, LiquidityShapeIconMap } from "../BinDistribution";
import { SerializedBinLiquidity } from "../../../convex/services/meteora";
import { FormattedBinPrice } from "../FormattedBinPrice";
import { useCreatePositionRangeStore } from "./RangeSelectorPanel";
import { QuoteDetails, QuoteDetailsSkeleton } from "../QuoteDetails";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useMutation as useTanstackMut } from "@tanstack/react-query";
import { startTrackingAction } from "../ActionTracker";
import { useBalances } from "~/states/balances";
import { Doc } from "../../../convex/_generated/dataModel";

export function ConfirmPositionContent({
  poolAddress,
  convexUser,
  onClose,
}: {
  poolAddress: Address;
  convexUser: Doc<"users">;
  onClose: () => void;
}) {
  const { collateralMint, collateralUiAmount, tokenXSplit, liquidityShape, resetCreatePositionState } =
    useCreatePositionState();
  const { lowerBin, upperBin, updateUpperLowerBins } = useCreatePositionRangeStore();
  const createPosition = useAction(api.actions.dlmmPosition.createPositionV2.createPosition);

  const { refetch: refetchBalances } = useBalances({ address: toAddress(convexUser.address) });

  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });
  const collateralToken = tokensMetadata[collateralMint];

  const depositRawAmount = amountToRawAmount(collateralUiAmount, collateralToken.decimals);
  const xDepositedRawAmount = depositRawAmount * tokenXSplit;
  const yDepositedRawAmount = depositRawAmount - xDepositedRawAmount;

  const needSwapX = pool.mint_x !== collateralMint;
  const needSwapY = pool.mint_y !== collateralMint;

  const { swapQuote: xSwapQuote, streamId: xStreamId } = useSwapQuote({
    inputMint: collateralMint,
    outputMint: tokenX.address,
    inputRawAmount: xDepositedRawAmount,
  });
  const { swapQuote: ySwapQuote, streamId: yStreamId } = useSwapQuote({
    inputMint: collateralMint,
    outputMint: tokenY.address,
    inputRawAmount: yDepositedRawAmount,
  });

  const quoteDetails = [
    xSwapQuote && { quoteId: xSwapQuote.id, streamId: xStreamId },
    ySwapQuote && { quoteId: ySwapQuote.id, streamId: yStreamId },
  ].filter(Boolean) as { quoteId: string; streamId: string }[];

  const createPositionMut = useTanstackMut({
    mutationFn: async () => {
      if (!lowerBin?.binId || !upperBin?.binId) {
        throw new Error("Range not selected!");
      }

      const createPositionPromise = createPosition({
        poolAddress,
        quoteDetails,
        liquidityShape: liquidityShape === "Bid-Ask" ? "BidAsk" : liquidityShape,
        autoCompoundSplit: 0,
        poolEntryPrice: pool.current_price,

        lowerBin: { id: lowerBin.binId, price: Number(lowerBin.pricePerToken) },
        upperBin: { id: upperBin.binId, price: Number(upperBin.pricePerToken) },

        collateral: {
          amount: collateralUiAmount,
          decimals: collateralToken.decimals,
          mint: collateralMint,
        },
        tokenX: {
          mint: pool.mint_x,
          decimals: tokenX.decimals,
          split: tokenXSplit,
        },
        tokenY: {
          mint: pool.mint_y,
          decimals: tokenY.decimals,
          split: 1 - tokenXSplit,
        },
      });

      onClose();
      startTrackingAction({
        type: "create_position",
        action: createPositionPromise,
        onSuccess: async () => {
          resetCreatePositionState();
          updateUpperLowerBins({ newLower: undefined, newUpper: undefined });
          await refetchBalances();
          //   await Promise.all([refetchTotals, refetchDlmmPositions]);
        },
      });
    },
  });
  return (
    <div className="flex flex-col w-[480px]">
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
      {needSwapY && <div className="w-full h-px bg-white/10 my-3" />}

      {lowerBin && upperBin && (
        <CratePositionDetails
          pool={pool}
          liquidityShape={liquidityShape}
          lowerBin={lowerBin}
          upperBin={upperBin}
          txIndex={needSwapX && needSwapY ? 3 : 2}
        />
      )}

      <Button
        variant="liquidPrimary"
        className="mb-0 mt-5"
        onClick={() => createPositionMut.mutate()}
        loading={createPositionMut.isPending}
      >
        Create Position
      </Button>
    </div>
  );
}

function CratePositionDetails({
  pool,
  liquidityShape,
  lowerBin,
  upperBin,
  txIndex,
}: {
  pool: MeteoraDlmmPool;
  liquidityShape: LiquidityShape;
  lowerBin: SerializedBinLiquidity;
  upperBin: SerializedBinLiquidity;
  txIndex: number;
}) {
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  const binCount = Math.max(0, upperBin.binId - lowerBin.binId + 1);
  const DistributionIcon = LiquidityShapeIconMap[liquidityShape];

  return (
    <div className="flex flex-col">
      <Row justify="start" className="items-center gap-3 mb-3">
        {/* Index */}
        <div className="text-textSecondary text-sm">#{txIndex}</div>

        {/* Token pair section */}
        <div className="flex flex-row items-center gap-1.5">
          <PoolTokenIcons size={28} xIcon={tokenX.icon} yIcon={tokenY.icon} />
          <div className="text-text">Create Position</div>
        </div>
      </Row>
      {/*Labels */}
      <div className="flex flex-col gap-0.5">
        <LabelValue
          variant="row"
          label={"Liquidity Distribution"}
          value={
            <Row className="gap-1">
              <DistributionIcon className="h-5 w-7" />
              {liquidityShape}
            </Row>
          }
        />

        <LabelValue
          variant="row"
          label={"Position Range"}
          value={
            <Row justify="start" className="gap-0.5">
              <FormattedBinPrice
                value={parseFloat(lowerBin?.pricePerToken ?? "0")}
                classname="text-text text-xs"
                significantDigits={5}
              />
              <div className="text-text text-xs">-</div>
              <FormattedBinPrice
                value={parseFloat(upperBin?.pricePerToken ?? "0")}
                classname="text-text text-xs"
                significantDigits={5}
              />
              <div className="text-text text-xs">{`(${binCount} Bins)`}</div>
            </Row>
          }
        />
      </div>
    </div>
  );
}

export function ConfirmPositionContentSkeleton() {
  return (
    <div className="flex flex-col w-[480px]">
      <div className="flex flex-col">
        <QuoteDetailsSkeleton />
        <div className="w-full h-px bg-white/10 my-3" />

        <QuoteDetailsSkeleton />
        <div className="w-full h-px bg-white/10 my-3" />

        <div className="flex flex-col">
          <Skeleton className="mb-3 w-32 h-5" />
          {/*Labels */}
          <div className="flex flex-col gap-0.5">
            <LabelValue variant="row" label={"Liquidity Distribution"} value={0} isLoading />

            <LabelValue variant="row" label={"Position Range"} value={0} isLoading />
          </div>
        </div>
      </div>

      <Button variant="liquidPrimary" className="mb-0 mt-5" disabled={true}>
        Create Position
      </Button>
    </div>
  );
}
