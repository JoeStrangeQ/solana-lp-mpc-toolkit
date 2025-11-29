import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { BidAskIcon } from "./icons/BidAskIcon";
import { CurveIcon } from "./icons/CurveIcon";
import { SpotIcon } from "./icons/SpotIcon";
import { SlidingSelect } from "./ui/SlidingSelector";
import { Row } from "./ui/Row";
import { Address } from "../../convex/utils/solana";
import { usePool } from "~/states/pools";
import { useToken } from "~/states/tokens";
import { SerializedBinLiquidity } from "../../convex/services/meteora";
import { useBinsAroundActiveBin } from "~/states/dlmm";
import { motion } from "motion/react";
import { FormattedBinPrice } from "./FormattedBinPrice";
import { cn } from "~/utils/cn";
import * as Slider from "@radix-ui/react-slider";

type LiquidityShape = "Spot" | "Curve" | "Bid-Ask";

export function BinDistribution({
  poolAddress,
  onLiquidityShapeChange,
}: {
  poolAddress: Address;
  onLiquidityShapeChange: (shape: LiquidityShape) => void;
}) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  const [liquidityShape, setLiqudityShape] = useState<LiquidityShape>("Spot");
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
          className="gap-0"
          options={liquidityShapes}
          value={liquidityShape}
          containerPaddingInPixels={{ px: 8, py: 8 }}
          onChange={(shape) => {
            setLiqudityShape(shape);
            onLiquidityShapeChange(shape);
          }}
        />

        <div className="flex flex-row items-center gap-2.5">
          <div className="flex flex-row gap-1 items-center">
            <div className="w-1 h-1 bg-purple rounded-full" />
            <div className="text-text text-xs">{tokenX.symbol}</div>
            <div className="text-textSecondary text-xs">35 / 69</div>
          </div>

          <div className="flex flex-row gap-1 items-center">
            <div className="w-1 h-1 bg-primary rounded-full " />
            <div className="text-text text-xs">{tokenY.symbol}</div>
            <div className="text-textSecondary text-xs">34 / 69</div>
          </div>
        </div>
      </Row>
      {/* <BinDistributionAdjuster
        shape={liquidityShape}
        poolAddress={poolAddress}
        tokenXAmount={100_000}
        tokenYAmount={100_000}
        maxBarHeight={100}
        // onRangeChange={(lower: number, upper: number) => {
        //   console.log("Lower", lower);
        //   console.log("upper", upper);
        // }}
      /> */}
    </div>
  );
}

type Props = {
  poolAddress: Address;
  shape: LiquidityShape;
  //   lowerBin: SerializedBinLiquidity;
  //   upperBin: SerializedBinLiquidity;
  tokenXAmount: number;
  tokenYAmount: number;
  maxBarHeight: number;
};

export function BinDistributionAdjuster({
  poolAddress,
  shape,
  //   lowerBin,
  //   upperBin,
  tokenXAmount,
  tokenYAmount,
  maxBarHeight,
}: Props) {
  const {
    binRange: { bins, activeBin: activeBinId },
    initialBins,
  } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: 67,
    numberOfBinsToTheRight: 67,
  });
  const [range, setRange] = useState<{ lowerBin: SerializedBinLiquidity; upperBin: SerializedBinLiquidity }>({
    lowerBin: initialBins[0],
    upperBin: initialBins[initialBins.length - 1],
  });
  const totalBins = useMemo(
    () => range.upperBin.binId - range.lowerBin.binId + 1,
    [range.lowerBin.binId, range.upperBin.binId]
  );

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

    const currentBinRange = bins.filter((b) => b.binId >= range.lowerBin.binId && b.binId <= range.upperBin.binId);

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
  }, [binsXCount, binsYCount, tokenXAmount, tokenYAmount, bins, range.lowerBin.binId, range.upperBin.binId]);

  // -----------------------------------------------------
  // 2️⃣ Auto-reset on activeBin change
  // -----------------------------------------------------
  useEffect(() => {
    const newCount = activeBinId - range.lowerBin.binId;
    setBinsYCount(newCount);
  }, [activeBinId, range.lowerBin.binId]);

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
        setRange({
          lowerBin: newLower,
          upperBin: newUpper,
        });
      }
    },
    [activeBinId, totalBins, bins]
  );

  // -----------------------------------------------------
  // 4️⃣ Memoized bottom price labels
  // -----------------------------------------------------
  const priceLabels = useMemo(() => {
    if (currentBinRange.length === 0) return null;
    const step = Math.floor((currentBinRange.length - 1) / 4);

    return [
      currentBinRange[0],
      currentBinRange[step],
      currentBinRange[step * 2],
      currentBinRange[step * 3],
      currentBinRange[currentBinRange.length - 1],
    ].map((bin) => (
      <FormattedBinPrice
        key={bin.binId}
        classname="text-textSecondary text-[10px]"
        value={parseFloat(bin.pricePerToken)}
        significantDigits={5}
      />
    ));
  }, [currentBinRange]);

  // -----------------------------------------------------
  // UI
  // -----------------------------------------------------

  return (
    <div className="flex flex-col w-full">
      <div className="flex flex-row items-end justify-between h-28 w-full gap-0.5">
        {currentBinRange.map((bin, index) => {
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

          const height = (amount / max) * maxBarHeight;

          return (
            <motion.div
              key={bin.binId}
              className={cn("flex-1 relative rounded-full", isTokenY ? "bg-purple" : "bg-primary")}
              initial={{ height: 0 }}
              animate={{ height }}
              transition={{ duration: 0.12 }}
            >
              {isActive && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-2xl">
                  <FormattedBinPrice
                    classname="text-text text-[10px]"
                    value={parseFloat(bin.pricePerToken)}
                    significantDigits={5}
                  />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Slider */}
      <Slider.Root
        className="relative flex items-center w-full"
        value={[binsYCount]}
        max={totalBins - 2}
        min={0}
        step={1}
        onValueChange={handleSlider}
      >
        {tokenXAmount !== 0 && tokenYAmount !== 0 && (
          <Slider.Thumb asChild>
            <div className="relative z-5 w-7 h-2.5 rounded-full bg-text/75 backdrop-blur-lg flex items-center justify-center cursor-grab hover:scale-110 transition">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-px h-1.5 bg-black rounded-full mx-px" />
              ))}
            </div>
          </Slider.Thumb>
        )}
      </Slider.Root>

      <div className="mt-2 flex flex-row justify-between w-full text-textSecondary text-xs font-mono">
        {priceLabels}
      </div>
    </div>
  );
}

// helpers
export function getLinearCurveHeights(binCount: number, tokenAmount: number, reverse = false): number[] {
  if (binCount <= 0) return [];
  const step = (2 * tokenAmount) / (binCount * (binCount + 1));
  const arr = Array.from({ length: binCount }, (_, i) => step * (i + 1));
  return reverse ? arr.reverse() : arr;
}
