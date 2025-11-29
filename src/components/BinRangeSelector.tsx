import { useEffect, useMemo, useRef, useState, PointerEvent as ReactPointerEvent } from "react";
import { useToken, useTokenPrice } from "~/states/tokens";
import { SerializedBinLiquidity } from "../../convex/services/meteora";
import { rawToAmountBN } from "../../convex/utils/amounts";
import { Address, toAddress } from "../../convex/utils/solana";
import { usePool } from "~/states/pools";
import { cn } from "~/utils/cn";
import { FormattedBinPrice } from "./FormattedBinPrice";
import BN from "bn.js";

interface Props {
  bins: SerializedBinLiquidity[];
  activeLowerBin: SerializedBinLiquidity;
  activeUpperBin: SerializedBinLiquidity;
  activeBinId: number;
  poolAddress: Address;
  maxBarHeight: number;
  onRangeChange: (lower: SerializedBinLiquidity, upper: SerializedBinLiquidity) => void;
}

type DragMode = "none" | "lower" | "upper" | "track";

export default function BinRangeSelector({
  bins,
  activeLowerBin,
  activeUpperBin,
  activeBinId,
  poolAddress,
  maxBarHeight,
  onRangeChange,
}: Props) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // --- TOKEN + PRICE HOOKS ---
  const tokenX = useToken({ mint: toAddress(pool.mint_x) });
  const tokenY = useToken({ mint: toAddress(pool.mint_y) });

  const tokenXPrice = useTokenPrice({ mint: tokenX?.address });
  const tokenYPrice = useTokenPrice({ mint: tokenY?.address });

  const decimalsX = tokenX?.decimals ?? 0;
  const decimalsY = tokenY?.decimals ?? 0;

  // --- INTERNAL STATE: indices, not objects ---
  const [lowerIndex, setLowerIndex] = useState<number>(() =>
    Math.max(
      0,
      bins.findIndex((b) => b.binId === activeLowerBin.binId)
    )
  );
  const [upperIndex, setUpperIndex] = useState<number>(() =>
    Math.min(
      bins.length - 1,
      bins.findIndex((b) => b.binId === activeUpperBin.binId)
    )
  );

  // Sync with external activeLowerBin/activeUpperBin when they change
  useEffect(() => {
    const li = bins.findIndex((b) => b.binId === activeLowerBin.binId);
    const ui = bins.findIndex((b) => b.binId === activeUpperBin.binId);
    if (li !== -1) setLowerIndex(li);
    if (ui !== -1) setUpperIndex(ui);
  }, [activeLowerBin.binId, activeUpperBin.binId, bins]);

  // --- OBSERVE WIDTH (no scroll, stretch to w-full) ---
  useEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => setContainerWidth(containerRef.current?.clientWidth ?? 0);

    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);

    return () => ro.disconnect();
  }, []);

  const totalBins = bins.length;
  const unitWidth = useMemo(() => (totalBins > 0 ? containerWidth / totalBins : 0), [containerWidth, totalBins]);
  const trackHeight = maxBarHeight + 32; // bars + some headroom

  // --- USD AMOUNTS → HEIGHTS ---
  const usdPerBin = useMemo(() => {
    if (!tokenX || !tokenY || !tokenXPrice || !tokenYPrice) {
      // fallback: equal heights if we don't have token data yet
      return bins.map(() => 1);
    }

    return bins.map((bin) => {
      const xRaw = new BN(bin.xAmount);
      const yRaw = new BN(bin.yAmount);

      const xBN = rawToAmountBN(xRaw, decimalsX);
      const yBN = rawToAmountBN(yRaw, decimalsY);

      const x = parseFloat(xBN.toString());
      const y = parseFloat(yBN.toString());

      return x * tokenXPrice + y * tokenYPrice;
    });
  }, [bins, tokenX, tokenY, tokenXPrice, tokenYPrice, decimalsX, decimalsY]);

  const maxUsd = useMemo(() => Math.max(1, ...usdPerBin), [usdPerBin]);

  const getBinHeight = (idx: number) => {
    const v = usdPerBin[idx] ?? 0;
    if (maxUsd <= 0) return maxBarHeight * 0.3;
    const ratio = v / maxUsd;
    return Math.max(4, ratio * maxBarHeight);
  };

  // --- DRAG LOGIC (pointer-based, no external state) ---
  const [dragMode, setDragMode] = useState<DragMode>("none");
  const dragStart = useRef<{
    mode: DragMode;
    lower: number;
    upper: number;
    x: number;
  } | null>(null);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (!containerRef.current || unitWidth === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    dragStart.current = {
      mode,
      lower: lowerIndex,
      upper: upperIndex,
      x: e.clientX,
    };
    setDragMode(mode);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || unitWidth === 0) return;

    const { mode, lower, upper, x: startX } = dragStart.current;
    const dx = e.clientX - startX;
    const deltaBins = Math.round(dx / unitWidth);

    const MAX_RANGE = 70;
    if (mode === "lower") {
      let nextLower = lower + deltaBins;

      // cannot pass outside
      nextLower = Math.max(0, nextLower);

      // cannot cross upper - 1
      nextLower = Math.min(nextLower, upperIndex - 1);

      // enforce max range
      if (upperIndex - nextLower + 1 > MAX_RANGE) {
        nextLower = upperIndex - MAX_RANGE + 1;
      }

      setLowerIndex(nextLower);
    } else if (mode === "upper") {
      let nextUpper = upper + deltaBins;

      // cannot pass outside
      nextUpper = Math.min(totalBins - 1, nextUpper);

      // cannot cross lower + 1
      nextUpper = Math.max(nextUpper, lowerIndex + 1);

      // enforce max range
      if (nextUpper - lowerIndex + 1 > MAX_RANGE) {
        nextUpper = lowerIndex + MAX_RANGE - 1;
      }

      setUpperIndex(nextUpper);
    } else if (mode === "track") {
      const size = Math.min(upper - lower + 1, MAX_RANGE);

      let nextLower = lower + deltaBins;
      let nextUpper = nextLower + size - 1;

      // clamp inside container
      if (nextLower < 0) {
        nextLower = 0;
        nextUpper = size - 1;
      }
      if (nextUpper > totalBins - 1) {
        nextUpper = totalBins - 1;
        nextLower = nextUpper - size + 1;
      }

      //  ensure at least 1 bin range
      if (nextUpper <= nextLower) {
        nextUpper = nextLower + 1;
      }

      setLowerIndex(nextLower);
      setUpperIndex(nextUpper);
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStart.current = null;
    setDragMode("none");

    const lowerBin = bins[lowerIndex];
    const upperBin = bins[upperIndex];

    if (lowerBin && upperBin) {
      onRangeChange(lowerBin, upperBin);
    }
  };

  const selectedWidth = (upperIndex - lowerIndex + 1) * unitWidth;
  const PRICE_LABELS_COUNT = 6;
  const labelsCount = Math.max(2, PRICE_LABELS_COUNT);

  // compute target indices evenly spaced across the bins
  const labelIndices = useMemo(() => {
    if (bins.length === 0) return [];

    const step = (bins.length - 1) / (labelsCount - 1); // e.g. 100 bins + 6 labels = step ~ 20
    const arr: number[] = [];

    for (let i = 0; i < labelsCount; i++) {
      arr.push(Math.round(step * i));
    }

    return arr;
  }, [bins.length, labelsCount]);

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
          {bins.map((bin, idx) => {
            const h = getBinHeight(idx);
            const isSelected = idx >= lowerIndex && idx <= upperIndex;
            const isActive = bin.binId === activeBinId;
            const isTokenX = bin.binId < activeBinId;

            const left = idx * unitWidth;
            const barWidth = Math.max(2, unitWidth * 0.7);

            const bgColor = isSelected
              ? isActive
                ? "bg-text/50"
                : isTokenX
                  ? "bg-purple/40"
                  : "bg-primary/40"
              : "bg-text/10";

            return (
              <div
                key={bin.binId}
                className={cn(
                  "absolute bottom-0 rounded-xs hover-effect",
                  bgColor,
                  isActive ? "opacity-100  " : "opacity-40"
                )}
                style={{ left, width: barWidth, height: h }}
              />
            );
          })}
        </div>

        {/* TRACK (dragging entire selection) */}
        <div
          className="absolute top-6 bottom-0 bg-white/2 cursor-grab active:cursor-grabbing"
          style={{
            left: lowerIndex * unitWidth,
            width: selectedWidth,
          }}
          onPointerDown={(e) => startDrag(e, "track")}
        />
        {/* LOWER HANDLE */}
        <RangeHandle
          x={lowerIndex * unitWidth}
          bin={bins[lowerIndex]}
          isDragging={dragMode === "lower"}
          onPointerDown={(e) => startDrag(e, "lower")}
        />

        {/* UPPER HANDLE */}
        <RangeHandle
          x={(upperIndex + 1) * unitWidth}
          bin={bins[upperIndex]}
          isDragging={dragMode === "upper"}
          onPointerDown={(e) => startDrag(e, "upper")}
        />

        {/* PRICE LABELS */}
      </div>
      <div className="relative w-full h-5 mt-1">
        {labelIndices.map((idx) => {
          const bin = bins[idx];
          if (!bin) return null;

          const left = idx * unitWidth;

          return (
            <div
              key={`price-${bin.binId}`}
              className="absolute translate-x-[-50%] text-[10px] text-textSecondary whitespace-nowrap"
              style={{
                left,
              }}
            >
              <FormattedBinPrice value={Number(bin.pricePerToken)} significantDigits={6} />
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
            {label ? <>{label}</> : <FormattedBinPrice value={Number(bin.pricePerToken)} significantDigits={6} />}
          </div>
        ))}

      {/* VERTICAL LINE */}
      <div
        className="
          flex-1 w-px opacity-80 
          relative
        "
      >
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
