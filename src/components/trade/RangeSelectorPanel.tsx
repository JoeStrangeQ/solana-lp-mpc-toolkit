import { useBinsAroundActiveBin } from "~/states/dlmm";
import { Row } from "../ui/Row";
import { Address } from "../../../convex/utils/solana";
import { create } from "zustand";
import { SerializedBinLiquidity } from "../../../convex/services/meteora";
import { useEffect, useRef, useState } from "react";
import BinRangeSelector, { BinRangeSelectorSkeleton } from "../BinRangeSelector";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "~/utils/cn";
import { Skeleton } from "../ui/Skeleton";
import { MnMSuspense } from "../MnMSuspense";
import { useRouterState } from "@tanstack/react-router";

interface BinRangeState {
  lowerBin: SerializedBinLiquidity | null;
  upperBin: SerializedBinLiquidity | null;
  updateUpperLowerBins: (p: { newLower?: SerializedBinLiquidity; newUpper?: SerializedBinLiquidity }) => void;
}

export const useCreatePositionRangeStore = create<BinRangeState>((set) => ({
  lowerBin: null,
  upperBin: null,
  updateUpperLowerBins: ({ newLower, newUpper }) =>
    set((state) => ({
      lowerBin: newLower ?? state.lowerBin,
      upperBin: newUpper ?? state.upperBin,
    })),
}));

const MIN_TOTAL = 70;
const MIN_SIDE = Math.floor(MIN_TOTAL / 2);
const MAX_SIDE = 120;
const BUFFER = 4;

export function RangeSelectorPanel({ poolAddress }: { poolAddress: Address }) {
  const { lowerBin, upperBin, updateUpperLowerBins } = useCreatePositionRangeStore();
  const initRef = useRef(false);
  const { binRange, initialBins } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: MAX_SIDE + BUFFER,
    numberOfBinsToTheRight: MAX_SIDE + BUFFER,
  });

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [sideBins, setSideBins] = useState(MIN_SIDE);

  // Initial range setup – once
  useEffect(() => {
    if (initRef.current) return;
    if (!binRange?.bins?.length) return;
    if (upperBin && lowerBin) return;

    const centerBinId = binRange.activeBin;
    const centerIndex = binRange.bins.findIndex((b) => b.binId === centerBinId);
    if (centerIndex === -1) return;

    const start = Math.max(0, centerIndex - sideBins);
    const end = Math.min(binRange.bins.length - 1, centerIndex + sideBins);

    const first = binRange.bins[start];
    const last = binRange.bins[end];

    if (!first || !last) return;

    const { lower, upper } = clampSelectedRange(first, last, binRange.bins);

    updateUpperLowerBins({
      newLower: lower,
      newUpper: upper,
    });

    initRef.current = true;
  }, [binRange, sideBins, lowerBin, upperBin, pathname, poolAddress]);

  if (!binRange?.bins?.length || !lowerBin || !upperBin) {
    return <RangeSelectorPanelSkeleton />;
  }

  const canZoomOut = sideBins > MIN_SIDE;
  const canZoomIn = sideBins < MAX_SIDE;

  return (
    <div className="flex flex-col items-center w-full gap-3 overflow-visible">
      <Row fullWidth>
        <Row justify="start" className="gap-1 items-baseline">
          <div className="text-text text-sm">Select range</div>
          <div className="text-textSecondary text-xs">{upperBin.binId - lowerBin.binId} Bins</div>
        </Row>

        <Row>
          {/* RESET RANGE */}
          <button
            className={cn(
              "flex rounded-full inner-white px-2 py-1 mr-2 bg-white/2 cursor-pointer hover:bg-white/5 active:scale-95"
            )}
            onClick={() => {
              updateUpperLowerBins({
                newLower: initialBins[0],
                newUpper: initialBins[initialBins.length - 1],
              });
              setSideBins(MIN_SIDE);
            }}
          >
            <RotateCcw className="w-3 h-3 text-text" />
          </button>

          {/* ZOOM OUT (narrower range) */}
          <button
            className={cn(
              "flex rounded-full rounded-r-none inner-white px-2 py-1",
              canZoomOut ? "bg-white/2 cursor-pointer hover:bg-white/5 active:scale-95" : "bg-white/5 opacity-40"
            )}
            disabled={!canZoomOut}
            onClick={() => setSideBins((v) => Math.max(MIN_SIDE, v - 10))}
          >
            <ZoomIn className="w-3 h-3 text-text" />
          </button>

          {/* ZOOM IN (wider range) */}
          <button
            className={cn(
              "flex rounded-full rounded-l-none inner-white px-2 py-1",
              canZoomIn ? "bg-white/2 cursor-pointer hover:bg-white/5 active:scale-95" : "bg-white/5 opacity-40"
            )}
            disabled={!canZoomIn}
            onClick={() => setSideBins((v) => Math.min(MAX_SIDE, v + 10))}
          >
            <ZoomOut className="w-3 h-3 text-text" />
          </button>
        </Row>
      </Row>

      <MnMSuspense fallback={<BinRangeSelectorSkeleton />}>
        <BinRangeSelector
          allBins={binRange.bins}
          activeBinId={binRange.activeBin}
          activeLowerBin={lowerBin}
          activeUpperBin={upperBin}
          sideBins={sideBins}
          buffer={BUFFER}
          maxBarHeight={64}
          poolAddress={poolAddress}
          onRangeChange={(lower, upper) => {
            const { lower: clampedLower, upper: clampedUpper } = clampSelectedRange(lower, upper, binRange.bins);

            updateUpperLowerBins({
              newLower: clampedLower,
              newUpper: clampedUpper,
            });
          }}
        />
      </MnMSuspense>
    </div>
  );
}

export function RangeSelectorPanelSkeleton() {
  return (
    <div className="flex flex-col items-center w-full gap-3 overflow-visible">
      <Row fullWidth>
        <Row justify="start" className="gap-1 items-center">
          <div className="text-text text-sm">Select range</div>
          <Skeleton className="w-16 h-3.5" />
        </Row>

        <Row>
          {/* RESET RANGE */}
          <button className={cn("flex rounded-full inner-white px-2 py-1 mr-2 bg-white/2 opacity-20")} disabled>
            <RotateCcw className="w-3 h-3 text-text" />
          </button>

          <button
            className={cn("flex rounded-full rounded-r-none inner-white px-2 py-1 bg-white/2 opacity-20")}
            disabled={true}
          >
            <ZoomIn className="w-3 h-3 text-text" />
          </button>

          <button
            className={cn("flex rounded-full rounded-l-none inner-white px-2 py-1 bg-white/2 opacity-20")}
            disabled={true}
          >
            <ZoomOut className="w-3 h-3 text-text" />
          </button>
        </Row>
      </Row>

      <BinRangeSelectorSkeleton />
    </div>
  );
}
function clampSelectedRange(
  lower: SerializedBinLiquidity,
  upper: SerializedBinLiquidity,
  bins: SerializedBinLiquidity[]
) {
  const MAX = 70;

  const lowerIndex = bins.findIndex((b) => b.binId === lower.binId);
  const upperIndex = bins.findIndex((b) => b.binId === upper.binId);

  if (lowerIndex === -1 || upperIndex === -1) return { lower, upper };

  const size = upperIndex - lowerIndex + 1;

  if (size <= MAX) return { lower, upper };

  const newLowerIndex = upperIndex - (MAX - 1);
  const clampedLower = bins[newLowerIndex];

  return {
    lower: clampedLower ?? lower,
    upper,
  };
}
