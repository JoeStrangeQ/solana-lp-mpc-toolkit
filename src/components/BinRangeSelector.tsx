import { useEffect, useMemo, useRef, useState, PointerEvent as ReactPointerEvent } from "react";
import { useToken, useTokenPrice } from "~/states/tokens";
import { SerializedBinLiquidity } from "../../convex/services/meteora";
import { rawToAmountBN } from "../../convex/utils/amounts";
import { Address, toAddress } from "../../convex/utils/solana";
import { usePool } from "~/states/pools";
import { cn } from "~/utils/cn";
import { FormattedBinPrice } from "./FormattedBinPrice";
import BN from "bn.js";
import { Skeleton } from "./ui/Skeleton";

interface Props {
  allBins: SerializedBinLiquidity[];
  activeLowerBin: SerializedBinLiquidity;
  activeUpperBin: SerializedBinLiquidity;
  activeBinId: number;
  poolAddress: Address;
  maxBarHeight: number;
  sideBins: number;
  buffer: number;
  onRangeChange: (lower: SerializedBinLiquidity, upper: SerializedBinLiquidity) => void;
}

type DragMode = "none" | "lower" | "upper" | "track";

const MAX_RANGE = 70;

export default function BinRangeSelector({
  allBins,
  activeLowerBin,
  activeUpperBin,
  activeBinId,
  poolAddress,
  maxBarHeight,
  sideBins,
  buffer,
  onRangeChange,
}: Props) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // TOKEN + PRICE
  const tokenX = useToken({ mint: toAddress(pool.mint_x) });
  const tokenY = useToken({ mint: toAddress(pool.mint_y) });

  const tokenXPrice = useTokenPrice({ mint: tokenX?.address });
  const tokenYPrice = useTokenPrice({ mint: tokenY?.address });

  const decimalsX = tokenX?.decimals ?? 0;
  const decimalsY = tokenY?.decimals ?? 0;

  // 1) Map current selection to GLOBAL indices in allBins
  const baseLowerIndex = useMemo(() => {
    const idx = allBins.findIndex((b) => b.binId === activeLowerBin.binId);
    if (idx === -1) return 0;
    return idx;
  }, [allBins, activeLowerBin.binId]);

  const baseUpperIndex = useMemo(() => {
    const idx = allBins.findIndex((b) => b.binId === activeUpperBin.binId);
    if (idx === -1) return Math.max(0, allBins.length - 1);
    return idx;
  }, [allBins, activeUpperBin.binId]);

  // Ensure base selection is valid
  const [pendingSelection, setPendingSelection] = useState<{
    lowerIndex: number;
    upperIndex: number;
  } | null>(null);

  // Effective selection (global indices)
  const { lowerIndex, upperIndex } = useMemo(() => {
    let lower = pendingSelection?.lowerIndex ?? baseLowerIndex;
    let upper = pendingSelection?.upperIndex ?? baseUpperIndex;

    if (upper <= lower) {
      upper = Math.min(lower + 1, allBins.length - 1);
    }

    if (upper - lower + 1 > MAX_RANGE) {
      lower = upper - (MAX_RANGE - 1);
    }

    lower = Math.max(0, lower);
    upper = Math.min(allBins.length - 1, upper);

    return { lowerIndex: lower, upperIndex: upper };
  }, [pendingSelection, baseLowerIndex, baseUpperIndex, allBins.length]);

  // 2) Active bin global index
  const activeIndex = useMemo(() => {
    const idx = allBins.findIndex((b) => b.binId === activeBinId);
    if (idx === -1) return Math.floor((lowerIndex + upperIndex) / 2);
    return idx;
  }, [allBins, activeBinId, lowerIndex, upperIndex]);

  // 3) Compute visible window indices from activeIndex + zoom
  const { visibleStart, visibleEnd } = useMemo(() => {
    if (!allBins.length) return { visibleStart: 0, visibleEnd: 0 };

    let start = activeIndex - sideBins - buffer;
    let end = activeIndex + sideBins + buffer;

    start = Math.max(0, start);
    end = Math.min(allBins.length - 1, end);

    if (end < start) end = start;

    return { visibleStart: start, visibleEnd: end };
  }, [allBins.length, activeIndex, sideBins, buffer]);

  const visibleBins = useMemo(() => allBins.slice(visibleStart, visibleEnd + 1), [allBins, visibleStart, visibleEnd]);

  const totalVisible = visibleBins.length;

  // 4) Visible selection indices (relative to visible window)
  const visibleLowerIndex = Math.min(Math.max(lowerIndex - visibleStart, 0), Math.max(totalVisible - 1, 0));
  const visibleUpperIndex = Math.min(Math.max(upperIndex - visibleStart, 0), Math.max(totalVisible - 1, 0));

  // 5) OBSERVE WIDTH
  useEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => setContainerWidth(containerRef.current?.clientWidth ?? 0);

    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);

    return () => ro.disconnect();
  }, []);

  const unitWidth = useMemo(
    () => (totalVisible > 0 ? containerWidth / totalVisible : 0),
    [containerWidth, totalVisible]
  );
  const trackHeight = maxBarHeight + 32;

  // 6) USD heights based on GLOBAL bins (so zoom doesn’t change scale)
  const usdPerBin = useMemo(() => {
    if (!tokenX || !tokenY || !tokenXPrice || !tokenYPrice) {
      return allBins.map(() => 1);
    }

    return allBins.map((bin) => {
      const xRaw = new BN(bin.xAmount);
      const yRaw = new BN(bin.yAmount);

      const xBN = rawToAmountBN(xRaw, decimalsX);
      const yBN = rawToAmountBN(yRaw, decimalsY);

      const x = parseFloat(xBN.toString());
      const y = parseFloat(yBN.toString());

      return x * tokenXPrice + y * tokenYPrice;
    });
  }, [allBins, tokenX, tokenY, tokenXPrice, tokenYPrice, decimalsX, decimalsY]);

  const maxUsd = useMemo(() => Math.max(1, ...usdPerBin), [usdPerBin]);

  const getBinHeight = (globalIndex: number) => {
    const v = usdPerBin[globalIndex] ?? 0;
    if (maxUsd <= 0) return maxBarHeight * 0.3;
    const ratio = v / maxUsd;
    return Math.max(4, ratio * maxBarHeight);
  };

  // 7) DRAG LOGIC (global indices)
  const [dragMode, setDragMode] = useState<DragMode>("none");
  const dragStart = useRef<{
    mode: DragMode;
    lowerIndex: number;
    upperIndex: number;
    x: number;
  } | null>(null);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (!containerRef.current || unitWidth === 0 || !totalVisible) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    dragStart.current = {
      mode,
      lowerIndex,
      upperIndex,
      x: e.clientX,
    };
    setDragMode(mode);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || unitWidth === 0 || !totalVisible) return;

    const { mode, lowerIndex: startLower, upperIndex: startUpper, x: startX } = dragStart.current;
    const dx = e.clientX - startX;
    const deltaBins = Math.round(dx / unitWidth);

    let nextLower = startLower;
    let nextUpper = startUpper;

    if (mode === "lower") {
      nextLower = startLower + deltaBins;
      nextLower = Math.max(0, nextLower);
      nextLower = Math.min(nextLower, nextUpper - 1);

      if (nextUpper - nextLower + 1 > MAX_RANGE) {
        nextLower = nextUpper - MAX_RANGE + 1;
      }
    } else if (mode === "upper") {
      nextUpper = startUpper + deltaBins;
      nextUpper = Math.min(allBins.length - 1, nextUpper);
      nextUpper = Math.max(nextUpper, nextLower + 1);

      if (nextUpper - nextLower + 1 > MAX_RANGE) {
        nextUpper = nextLower + MAX_RANGE - 1;
      }
    } else if (mode === "track") {
      const size = Math.min(startUpper - startLower + 1, MAX_RANGE);

      nextLower = startLower + deltaBins;
      nextUpper = nextLower + size - 1;

      if (nextLower < 0) {
        nextLower = 0;
        nextUpper = size - 1;
      }
      if (nextUpper > allBins.length - 1) {
        nextUpper = allBins.length - 1;
        nextLower = nextUpper - size + 1;
      }

      if (nextUpper <= nextLower) {
        nextUpper = nextLower + 1;
      }
    }

    setPendingSelection({ lowerIndex: nextLower, upperIndex: nextUpper });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStart.current = null;
    setDragMode("none");

    const finalLower = lowerIndex;
    const finalUpper = upperIndex;

    const lowerBin = allBins[finalLower];
    const upperBin = allBins[finalUpper];

    if (lowerBin && upperBin) {
      onRangeChange(lowerBin, upperBin);
    }

    setPendingSelection(null);
  };

  const selectedWidth = (visibleUpperIndex - visibleLowerIndex + 1) * unitWidth;

  const PRICE_LABELS_COUNT = 8;
  const labelsCount = Math.max(2, PRICE_LABELS_COUNT);

  const labelIndices = useMemo(() => {
    if (visibleBins.length === 0) return [];

    const step = (visibleBins.length - 1) / (labelsCount - 1);
    const arr: number[] = [];

    for (let i = 0; i < labelsCount; i++) {
      arr.push(Math.round(step * i));
    }

    return arr;
  }, [visibleBins.length, labelsCount]);

  const visibleLower = lowerIndex - visibleStart;
  const visibleUpper = upperIndex - visibleStart;

  const safeVisibleLower = Math.min(Math.max(visibleLower, 0), visibleBins.length - 1);
  const safeVisibleUpper = Math.min(Math.max(visibleUpper, 0), visibleBins.length - 1);

  return (
    <div className="relative w-full select-none">
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: trackHeight }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* BARS */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end">
          {visibleBins.map((bin, idx) => {
            const globalIndex = visibleStart + idx;
            const h = getBinHeight(globalIndex);

            const isSelected = globalIndex >= lowerIndex && globalIndex <= upperIndex;
            const isActive = bin.binId === activeBinId;
            const isTokenX = bin.binId > activeBinId; // adjust if you consider X on which side

            const left = idx * unitWidth;
            const barWidth = Math.max(2, unitWidth * 0.7);

            const bgColor = isSelected
              ? isActive
                ? "bg-text/50"
                : isTokenX
                  ? "bg-primary/40"
                  : "bg-purple/40"
              : "bg-text/10";

            return (
              <div
                key={bin.binId}
                className={cn(
                  "absolute bottom-0 rounded-xs hover-effect",
                  bgColor,
                  isActive ? "opacity-100" : "opacity-40"
                )}
                style={{ left, width: barWidth, height: h }}
              />
            );
          })}
        </div>

        {/* TRACK (drag selection) */}
        {totalVisible > 0 && (
          <div
            className="absolute top-6 bottom-0 bg-white/2 cursor-grab active:cursor-grabbing"
            style={{
              left: visibleLowerIndex * unitWidth,
              width: selectedWidth,
            }}
            onPointerDown={(e) => startDrag(e, "track")}
          />
        )}

        {/* LOWER HANDLE */}
        {visibleBins[safeVisibleLower] && (
          <RangeHandle
            x={safeVisibleLower * unitWidth}
            bin={allBins[lowerIndex]} // Global bin (correct)
            isDragging={dragMode === "lower"}
            onPointerDown={(e) => startDrag(e, "lower")}
          />
        )}

        {/* UPPER HANDLE */}
        {visibleBins[safeVisibleUpper] && (
          <RangeHandle
            x={(safeVisibleUpper + 1) * unitWidth}
            bin={allBins[upperIndex]} // Global bin (correct)
            isDragging={dragMode === "upper"}
            onPointerDown={(e) => startDrag(e, "upper")}
          />
        )}
      </div>

      {/* PRICE LABELS */}
      <div className="relative w-full h-5">
        {labelIndices.map((idx, i) => {
          const bin = visibleBins[idx];
          if (!bin) return null;

          const barWidth = Math.max(2, unitWidth * 0.7);
          const barCenter = idx * unitWidth + barWidth / 2;

          let translate = "-50%";
          if (i === 0) translate = "0";
          else if (i === labelIndices.length - 1) translate = "-100%";

          return (
            <div
              key={`price-${bin.binId}`}
              className="flex absolute h-min mt-1.5"
              style={{
                left: barCenter,
                transform: `translateX(${translate})`,
              }}
            >
              <FormattedBinPrice
                classname="text-[10px] text-textSecondary whitespace-nowrap"
                value={Number(bin.pricePerToken)}
                significantDigits={6}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RangeHandle({
  x,
  bin,
  isDragging,
  label,
  onPointerDown,
}: {
  x: number;
  bin: SerializedBinLiquidity;
  isDragging: boolean;
  label?: string;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn("absolute top-0 bottom-0 flex flex-col items-center")}
      style={{ left: x, transform: "translateX(-50%)" }}
    >
      {/* LABEL */}
      {label ||
        (bin?.pricePerToken && (
          <div
            className={cn(
              `
          mb-1 px-2 py-1.5 rounded-full text-[10px] font-medium
          bg-white/5  backdrop-blur-sm text-white shadow
          transition-all duration-150
        `,
              isDragging && "scale-110"
            )}
          >
            {label ? label : <FormattedBinPrice value={Number(bin.pricePerToken)} significantDigits={6} />}
          </div>
        ))}

      {/* VERTICAL LINE */}
      <div className="flex-1 w-px opacity-80 relative">
        <div
          className={cn(
            "absolute inset-0 bg-[linear-gradient(to_bottom,var(--color-text)_50%,transparent_50%)] transition-transform",
            isDragging && "scale-110"
          )}
          style={{
            backgroundSize: "2px 10px",
          }}
        />
      </div>

      {/* HANDLE */}
      <div
        onPointerDown={onPointerDown}
        className="absolute top-1/2 -translate-y-0.5
          w-4 h-5 rounded-sm bg-text/60 backdrop-blur-xs 
          shadow-md cursor-ew-resize flex flex-row gap-0.5 items-center justify-center
          active:scale-90 transition-transform
        "
      >
        <div className="w-0.5 h-2.5 bg-black/80 rounded-full" />
        <div className="w-0.5 h-2.5 bg-black/80 rounded-full" />
      </div>
    </div>
  );
}

export function BinRangeSelectorSkeleton() {
  return (
    <div className="flex flex-col w-full">
      <div className="flex flex-row items-end justify-between gap-1 w-full">
        {Array.from({ length: 54 }).map((_, i) => (
          <Skeleton key={i} className={cn(" rounded-xs hover-effect bg-text/10 h-16 w-full")} />
        ))}
      </div>

      <div className="mt-2 flex flex-row justify-between w-full select-none">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-3 bg-text/10 rounded-sm"
            style={{ width: `${100 / 10}%` }} // auto-scales, nicer on all screens
          />
        ))}
      </div>
    </div>
  );
}
