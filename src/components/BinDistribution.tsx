import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { BidAskIcon } from "./icons/BidAskIcon";
import { CurveIcon } from "./icons/CurveIcon";
import { SpotIcon } from "./icons/SpotIcon";
import { SlidingSelect } from "./ui/SlidingSelector";
import { Row } from "./ui/Row";
import { Address } from "../../convex/utils/solana";
import { usePool } from "~/states/pools";
import { useCollateralToTokenAmount, useToken } from "~/states/tokens";
import { SerializedBinLiquidity } from "../../convex/services/meteora";
import { useBinsAroundActiveBin } from "~/states/dlmm";
import { motion } from "motion/react";
import { FormattedBinPrice } from "./FormattedBinPrice";
import { cn } from "~/utils/cn";
import * as Slider from "@radix-ui/react-slider";
import { Skeleton } from "./ui/Skeleton";

export type LiquidityShape = "Spot" | "Curve" | "Bid-Ask";

export function BinDistribution({
  poolAddress,
  liquidityShape,
  lowerBin,
  upperBin,
  collateralMint,
  collateralUiAmount,
  tokenXSplit,
  onLiquidityShapeChange,
  onRangeChange,
}: {
  poolAddress: Address;
  collateralMint: Address;
  collateralUiAmount: number;
  tokenXSplit: number;
  liquidityShape: LiquidityShape;
  lowerBin: SerializedBinLiquidity | null;
  upperBin: SerializedBinLiquidity | null;

  onLiquidityShapeChange: (shape: LiquidityShape) => void;
  onRangeChange: (p: { newLower?: SerializedBinLiquidity | undefined; newUpper?: SerializedBinLiquidity }) => void;
}) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });
  const {
    binRange: { activeBin: activeBinId },
  } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: 67,
    numberOfBinsToTheRight: 67,
  });

  const { tokenUsdAmount: xUsdAmount } = useCollateralToTokenAmount({
    mint: pool.mint_x,
    split: tokenXSplit,
    collateralAmount: collateralUiAmount,
    collateralMint: collateralMint,
  });

  const { tokenUsdAmount: yUsdAmount } = useCollateralToTokenAmount({
    mint: pool.mint_y,
    split: 1 - tokenXSplit,
    collateralAmount: collateralUiAmount,
    collateralMint: collateralMint,
  });

  const upperBinId = upperBin?.binId ?? 0;
  const lowerBinId = lowerBin?.binId ?? 0;

  const totalBins = Math.max(0, upperBinId - lowerBinId + 1);

  let yBinCount = 0;
  if (lowerBin) {
    yBinCount = activeBinId - lowerBinId + 1;
    yBinCount = Math.max(0, Math.min(yBinCount, totalBins));
  }

  const xBinCount = Math.max(0, totalBins - yBinCount);

  const liquidityShapes: { id: LiquidityShape; element: ReactNode }[] = [
    {
      id: "Spot",
      element: (
        <Row className="gap-1">
          <SpotIcon className="w-5 h-2" colored={liquidityShape === "Spot"} />
          <div className="text-text text-xs">Spot</div>
        </Row>
      ),
    },
    {
      id: "Curve",
      element: (
        <Row className="gap-1">
          <CurveIcon className="w-5 h-2" colored={liquidityShape === "Curve"} />
          <div className="text-text text-xs">Curve</div>
        </Row>
      ),
    },
    {
      id: "Bid-Ask",
      element: (
        <Row className="gap-1">
          <BidAskIcon className="w-5 h-2" colored={liquidityShape === "Bid-Ask"} />
          <div className="text-text text-xs">Bid-Ask</div>
        </Row>
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <Row>
        <SlidingSelect
          className="gap-0 bg-backgroundTertiary"
          options={liquidityShapes}
          value={liquidityShape}
          containerPaddingInPixels={{ px: 8, py: 8 }}
          onChange={(shape) => {
            onLiquidityShapeChange(shape);
          }}
        />

        <div className="flex flex-row items-center gap-2.5">
          <div className="flex flex-row gap-1 items-center">
            <div className="w-1 h-1 bg-primary rounded-full" />
            <div className="text-text text-xs">{tokenX.symbol}</div>
            <div className="text-textSecondary text-xs">
              {xBinCount}/{totalBins}
            </div>
          </div>

          <div className="flex flex-row gap-1 items-center">
            <div className="w-1 h-1 bg-purple rounded-full " />
            <div className="text-text text-xs">{tokenY.symbol}</div>
            <div className="text-textSecondary text-xs">
              {yBinCount}/{totalBins}
            </div>
          </div>
        </div>
      </Row>

      {!lowerBin || !upperBin ? (
        <BinDistributionAdjusterSkeleton label="Loading Bins" maxBarHeight={80} shape={liquidityShape} />
      ) : (
        <BinDistributionAdjuster
          shape={liquidityShape}
          poolAddress={poolAddress}
          tokenXAmount={xUsdAmount}
          tokenYAmount={yUsdAmount}
          maxBarHeight={80}
          lowerBin={lowerBin}
          upperBin={upperBin}
          onRangeChange={({ lower, upper }) => {
            onRangeChange({ newLower: lower, newUpper: upper });
          }}
        />
      )}
    </div>
  );
}

type BinDistributionAdjusterProps = {
  poolAddress: Address;
  shape: LiquidityShape;
  lowerBin: SerializedBinLiquidity;
  upperBin: SerializedBinLiquidity;
  tokenXAmount: number;
  tokenYAmount: number;
  maxBarHeight: number;
  onRangeChange: (p: { lower: SerializedBinLiquidity; upper: SerializedBinLiquidity }) => void;
};

function BinDistributionAdjuster({
  poolAddress,
  shape,
  lowerBin,
  upperBin,
  tokenXAmount,
  tokenYAmount,
  maxBarHeight,
  onRangeChange,
}: BinDistributionAdjusterProps) {
  const {
    binRange: { bins, activeBin: activeBinId },
  } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: 67,
    numberOfBinsToTheRight: 67,
  });
  const [isDragging, setIsDragging] = useState(false);
  const totalBins = useMemo(() => upperBin.binId - lowerBin.binId + 1, [lowerBin.binId, upperBin.binId]);

  const [binsYCount, setBinsYCount] = useState(Math.round(totalBins / 2));
  const binsXCount = totalBins - binsYCount;

  const {
    spotAmountPerBinY,
    spotAmountPerBinX,
    curveHeightsX,
    curveHeightsY,
    bidAskHeightsX,
    bidAskHeightsY,
    maxAmountSpot,
    maxAmountCurve,
    currentBinRange,
  } = useMemo(() => {
    const spotAmountPerBinY = tokenYAmount / Math.max(binsYCount, 1);
    const spotAmountPerBinX = tokenXAmount / Math.max(binsXCount, 1);

    const curveHeightsX = getLinearCurveHeights(binsXCount + 1, tokenXAmount, true);
    const curveHeightsY = getLinearCurveHeights(binsYCount, tokenYAmount);

    const bidAskHeightsX = [...curveHeightsX].reverse();
    const bidAskHeightsY = [...curveHeightsY].reverse();

    const maxAmountSpot = Math.max(spotAmountPerBinX, spotAmountPerBinY);
    const maxAmountCurve = Math.max(...curveHeightsX, ...curveHeightsY);

    const currentBinRange = bins.filter((b) => b.binId >= lowerBin.binId && b.binId <= upperBin.binId);

    return {
      spotAmountPerBinY,
      spotAmountPerBinX,
      curveHeightsX,
      curveHeightsY,
      bidAskHeightsX,
      bidAskHeightsY,
      maxAmountSpot,
      maxAmountCurve,
      currentBinRange,
    };
  }, [binsXCount, binsYCount, tokenXAmount, tokenYAmount, bins, lowerBin.binId, upperBin.binId]);

  // -----------------------------------------------------
  // 2️⃣ Auto-reset on activeBin change
  // -----------------------------------------------------
  useEffect(() => {
    const newCount = activeBinId - lowerBin.binId;
    setBinsYCount(newCount);
  }, [activeBinId, lowerBin.binId]);

  // -----------------------------------------------------
  // 3️⃣ Memoized slider callback
  // -----------------------------------------------------
  const handleSlider = useCallback(
    ([value]: number[]) => {
      setBinsYCount(value);

      const newLowerId = activeBinId - value;
      const newUpperId = activeBinId + (totalBins - value - 1);

      const newLower = bins.find((b) => b.binId === newLowerId);
      const newUpper = bins.find((b) => b.binId === newUpperId);

      if (newLower && newUpper) {
        onRangeChange({ lower: newLower, upper: newUpper });
      }
    },
    [activeBinId, totalBins, bins]
  );

  // -----------------------------------------------------
  // 4️⃣ Memoized bottom price labels
  // -----------------------------------------------------
  const priceLabels = useMemo(() => {
    const bins = currentBinRange;
    const n = bins.length;

    if (n === 0) return null;

    // Max 5 labels, or fewer if bins < 5
    const labelCount = Math.min(5, n);

    // Pre-generate indices safely
    const indices = [];
    for (let i = 0; i < labelCount; i++) {
      const pos = Math.round((i / (labelCount - 1)) * (n - 1));
      indices.push(pos);
    }

    return indices.map((idx, i) => {
      const bin = bins[idx];
      if (!bin) return null;

      let value = Number(bin.pricePerToken);

      // Avoid e-notation, avoid huge strings
      if (!isFinite(value)) value = 0;
      const safeValue = value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
        notation: "standard",
      });

      return (
        <div
          key={bin.binId + "-" + i}
          className="max-w-16 truncate overflow-hidden text-ellipsis text-[10px] text-textSecondary"
        >
          {safeValue}
        </div>
      );
    });
  }, [currentBinRange]);

  // -----------------------------------------------------
  // UI
  // -----------------------------------------------------

  const binsGap = totalBins < 10 ? "gap-2" : totalBins < 25 ? "gap-1.5" : totalBins < 40 ? "gap-1" : "gap-0.5";
  return (
    <div className={"flex flex-col w-full"}>
      <div
        className={cn("flex flex-row items-end justify-between w-full", binsGap)}
        style={{ height: maxBarHeight + 30 }}
      >
        {tokenXAmount === 0 && tokenYAmount === 0 ? (
          <BinDistributionAdjusterSkeleton
            label="No collateral detected"
            maxBarHeight={80}
            shape={shape}
            renderPriceLabels={false}
          />
        ) : (
          currentBinRange.map((bin, index) => {
            const isTokenY = bin.binId < activeBinId;
            const isActive = bin.binId === activeBinId;

            const binLocalIndex = isTokenY ? index : index - binsYCount;

            const amount =
              shape === "Spot"
                ? isTokenY
                  ? spotAmountPerBinY
                  : spotAmountPerBinX
                : shape === "Curve"
                  ? isTokenY
                    ? curveHeightsY[index]
                    : (curveHeightsX[binLocalIndex] ?? 0)
                  : isTokenY
                    ? bidAskHeightsY[index]
                    : (bidAskHeightsX[binLocalIndex] ?? 0);

            const max = shape === "Spot" ? maxAmountSpot : maxAmountCurve;

            const minHeight = (isTokenY && tokenYAmount === 0) || (!isTokenY && tokenXAmount === 0) ? 0 : 2;
            const height = Math.max(minHeight, (amount / max) * maxBarHeight);

            return (
              <motion.div
                key={bin.binId}
                className={cn(
                  "flex-1 relative rounded-xl  ",
                  "rounded-b-none",
                  isActive ? "bg-white/75" : isTokenY ? "bg-purple/75" : "bg-primary/75"
                )}
                initial={{ height: 0 }}
                animate={{ height }}
                transition={{ duration: 0.12 }}
              >
                {isActive && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 4 }}
                    animate={isDragging ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 4 }}
                    transition={{
                      duration: 0.18,
                      ease: "easeOut",
                    }}
                    className="flex select-none absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded-full bg-backgroundQuaternary backdrop-blur-2xl shadow-lg border border-white/10"
                  >
                    <FormattedBinPrice
                      classname="text-text text-[10px]"
                      value={parseFloat(bin.pricePerToken)}
                      significantDigits={5}
                    />
                  </motion.div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {/* Slider */}
      <Slider.Root
        className="relative flex items-center w-full "
        value={[binsYCount]}
        max={totalBins - 2}
        min={0}
        step={1}
        onValueChange={handleSlider}
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
      >
        {!(tokenXAmount === 0 && tokenYAmount === 0) && (
          <Slider.Thumb asChild>
            <div className="relative z-5 w-7 h-2.5 rounded-full outline-0  bg-text/75 backdrop-blur-lg flex items-center justify-center cursor-grab active:scale-95 transition-transform">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-px h-1.5 bg-black rounded-full mx-px" />
              ))}
            </div>
          </Slider.Thumb>
        )}
      </Slider.Root>

      <div className="mt-2 flex flex-row justify-between w-full select-none text-textSecondary text-xs">
        {priceLabels}
      </div>
    </div>
  );
}

// helpers
function getLinearCurveHeights(binCount: number, tokenAmount: number, reverse = false): number[] {
  if (binCount <= 0) return [];
  const step = (2 * tokenAmount) / (binCount * (binCount + 1));
  const arr = Array.from({ length: binCount }, (_, i) => step * (i + 1));
  return reverse ? arr.reverse() : arr;
}

export function BinDistributionSkeleton() {
  return (
    <div className="flex flex-col">
      <Row>
        <Skeleton className="w-40 h-7 rounded-full" />

        <div className="flex flex-row items-center gap-2.5">
          <Skeleton className="w-16 h-3.5" />
          <Skeleton className="w-16 h-3.5" />
        </div>
      </Row>

      <BinDistributionAdjusterSkeleton label="Loading Bins" maxBarHeight={80} shape={"Spot"} />
    </div>
  );
}
function BinDistributionAdjusterSkeleton({
  label = "Loading",
  maxBarHeight,
  shape,
  binCount = 25,
  renderPriceLabels = true,
}: {
  label?: string;
  maxBarHeight: number;
  shape: LiquidityShape;
  binCount?: number;
  renderPriceLabels?: boolean;
}) {
  const heights = getSkeletonHeights({ shape, binCount, maxBarHeight });

  return (
    <div className="flex flex-col w-full ">
      {/* Bars container */}
      <div className="relative w-full px-3" style={{ height: maxBarHeight + 10 }}>
        {/* Bars */}
        <div className="absolute inset-0 flex flex-row items-end justify-between gap-1.5">
          {heights.map((h, i) => (
            <motion.div
              key={i}
              className="flex flex-1 w-min rounded-xl rounded-b-none bg-text/10"
              initial={false}
              animate={{ height: h }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            />
          ))}
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full h-full backdrop-blur-xs rounded-xl flex items-center justify-center"
          >
            <div className="flex bg-white/10 backdrop-blur-lg px-2 py-1.5 rounded-xl">
              <div className="text-textSecondary text-sm">{label}</div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Price labels placeholder */}
      {renderPriceLabels && (
        <div className="mt-2 flex flex-row justify-between w-full select-none">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-3 bg-text/10 rounded-sm"
              style={{ width: `${100 / 10}%` }} // auto-scales, nicer on all screens
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getSkeletonHeights({
  shape,
  binCount,
  maxBarHeight,
}: {
  shape: LiquidityShape;
  binCount: number;
  maxBarHeight: number;
}) {
  if (shape === "Spot") {
    // Flat proportional placeholders
    return Array.from({ length: binCount }, () => maxBarHeight);
  }

  if (shape === "Curve") {
    // Smooth symmetric curve
    const mid = Math.floor(binCount / 2);
    return Array.from({ length: binCount }, (_, i) => {
      const dist = Math.abs(i - mid);
      const factor = 1 - dist / mid; // center tallest
      return Math.max(0.1, factor) * maxBarHeight;
    });
  }

  if (shape === "Bid-Ask") {
    // Two peaks on the sides
    const mid = Math.floor(binCount / 2);
    return Array.from({ length: binCount }, (_, i) => {
      const distLeft = i;
      const distRight = binCount - 1 - i;
      const factor = Math.max(1 - distLeft / mid, 1 - distRight / mid); // peaks on both sides
      return Math.max(0.1, factor) * maxBarHeight;
    });
  }

  return Array.from({ length: binCount }, () => maxBarHeight * 0.5);
}
