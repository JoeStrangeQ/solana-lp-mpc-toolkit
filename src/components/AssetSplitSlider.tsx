import * as Slider from "@radix-ui/react-slider";
import { useEffect, useState } from "react";
import { cn } from "~/utils/cn";
import { Address } from "../../convex/utils/solana";
import { useCollateralToTokenAmount, useToken } from "~/states/tokens";
import { Row } from "./ui/Row";
import { TokenIcon } from "./TokenIcon";
import {
  abbreviateAmount,
  formatTokenAmount,
  formatUsdValue,
} from "~/utils/numberFormats";
import { usePool } from "~/states/pools";
import { useBinsAroundActiveBin } from "~/states/dlmm";
import { SerializedBinLiquidity } from "../../convex/services/meteora";
import { Skeleton } from "./ui/Skeleton";
import { MnMSuspense } from "./MnMSuspense";

export function AssetSplit({
  poolAddress,
  collateralAmount,
  collateralMint,
  tokenXSplit,
  lowerBin,
  upperBin,
  disabled = false,
  onSplitChange,
}: {
  poolAddress: Address;
  collateralMint: Address;
  collateralAmount: number;
  tokenXSplit: number;
  lowerBin: SerializedBinLiquidity | null;
  upperBin: SerializedBinLiquidity | null;
  disabled?: boolean;
  onSplitChange: (newSplitX: number) => void;
}) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const {
    binRange: { activeBin },
  } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: 124,
    numberOfBinsToTheRight: 124,
  });

  useEffect(() => {
    if (!lowerBin || !upperBin) return;
    if (lowerBin.binId >= activeBin) {
      onSplitChange(1);
    }

    if (upperBin.binId <= activeBin) {
      onSplitChange(0);
    }
  }, [lowerBin, upperBin, activeBin]);

  useEffect(() => {
    if (tokenXSplit === 0) {
    }
  }, [tokenXSplit]);
  return (
    <div className="flex flex-col ">
      <div className="flex bg-backgroundTertiary inner-white rounded-full px-2 py-3 mb-1.5">
        <AssetSplitSlider
          leftTrackColor="#B6D162"
          rightTrackColor="#A866DD"
          leftTrackSplit={tokenXSplit}
          onChange={onSplitChange}
          height={8}
          disabled={disabled}
        />
      </div>

      <Row fullWidth>
        <MnMSuspense fallback={<AssetAmountSkeleton />}>
          <AssetAmount
            mint={pool.mint_x}
            split={tokenXSplit}
            collateralMint={collateralMint}
            collateralAmount={collateralAmount}
          />
        </MnMSuspense>
        <MnMSuspense fallback={<AssetAmountSkeleton align="end" />}>
          <AssetAmount
            align="end"
            mint={pool.mint_y}
            split={1 - tokenXSplit}
            collateralMint={collateralMint}
            collateralAmount={collateralAmount}
          />
        </MnMSuspense>
      </Row>
    </div>
  );
}

export function AssetSplitSkelton() {
  return (
    <div className="flex flex-col ">
      <div className="flex bg-backgroundTertiary inner-white rounded-full px-2 py-3 mb-1.5">
        <AssetSplitSlider
          leftTrackColor="#B6D162"
          rightTrackColor="#A866DD"
          leftTrackSplit={0.5}
          onChange={() => {}}
          height={8}
          disabled={true}
        />
      </div>

      <Row fullWidth>
        <AssetAmountSkeleton />
        <AssetAmountSkeleton align="end" />
      </Row>
    </div>
  );
}

function AssetAmount({
  mint,
  split,
  collateralAmount,
  collateralMint,
  align = "start",
}: {
  mint: Address;
  split: number;
  collateralMint: Address;
  collateralAmount: number;
  align?: "start" | "center" | "end";
}) {
  const token = useToken({ mint });
  const { tokenUsdAmount, tokenAmount } = useCollateralToTokenAmount({
    collateralAmount,
    collateralMint,
    mint,
    split,
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-px",
        align === "start" && "items-start",
        align === "center" && "items-center",
        align === "end" && "items-end",
      )}
    >
      <Row className="gap-0.5" justify={align}>
        <TokenIcon className="w-3.5 h-3.5" icon={token.icon} />
        <div className="text-text font-normal text-xs">
          {formatTokenAmount(tokenAmount, token.symbol)}
        </div>
      </Row>

      <Row className="gap-1" justify={align}>
        <div className="text-textSecondary font-normal text-xs">
          {formatUsdValue(tokenUsdAmount)}
        </div>
        <div className="text-textSecondary/70 font-normal text-xs">
          {abbreviateAmount(split * 100, { type: "percentage", decimals: 0 })}%
        </div>
      </Row>
    </div>
  );
}

function AssetAmountSkeleton({
  align = "start",
}: {
  align?: "start" | "center" | "end";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-px",
        align === "start" && "items-start",
        align === "center" && "items-center",
        align === "end" && "items-end",
      )}
    >
      <Row className="gap-0.5" justify={align}>
        <Skeleton className="w-3.5 h-3.5 rounded-full" />
        <Skeleton className="w-16 h-3" />
      </Row>

      <Row className="gap-1" justify={align}>
        <Skeleton className="w-8 h-3" />
        <Skeleton className="w-5 h-3" />
      </Row>
    </div>
  );
}
type AssetSplitSliderProps = {
  showToolTip?: boolean;
  leftTrackColor: string;
  rightTrackColor: string;
  leftTrackSplit: number; // from 0 to 1
  onChange: (value: number) => void;
  className?: string;
  height?: number; // in px
  disabled?: boolean;
};

export function AssetSplitSlider({
  showToolTip,
  leftTrackColor,
  rightTrackColor,
  leftTrackSplit,
  onChange,
  className,
  height = 20, // default to 20px if not specified
  disabled = false,
}: AssetSplitSliderProps) {
  const [hovered, setHovered] = useState(false);
  const percentage = Math.round(leftTrackSplit * 100);

  return (
    <div className={cn("w-full relative", className)}>
      <Slider.Root
        className={cn(
          "relative flex items-center select-none w-full",
          disabled && "cursor-not-allowed opacity-50",
        )}
        style={{ height }}
        value={[percentage]}
        max={100}
        min={0}
        step={1}
        disabled={disabled}
        onValueChange={([value]) =>
          onChange(parseFloat((value / 100).toFixed(2)))
        }
      >
        {/* Left Track */}
        <div
          className={cn(
            "absolute left-0 top-0",
            leftTrackSplit === 1 ? "rounded-full" : "rounded-l-full",
          )}
          style={{
            height,
            width: `${percentage}%`,
            backgroundColor: leftTrackColor,
          }}
        />

        {/* Right Track */}
        <div
          className={cn(
            "absolute right-0 top-0",
            leftTrackSplit === 0 ? "rounded-full" : "rounded-r-full",
          )}
          style={{
            height,
            width: `${100 - percentage}%`,
            backgroundColor: rightTrackColor,
          }}
        />

        {/* Thumb */}
        <Slider.Thumb asChild>
          <div
            className={cn(
              "relative z-5 w-5 h-5 rounded-full bg-text hover:scale-105 transition outline-0",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
            )}
            style={{
              height: height * 2,
              width: height * 2,
            }}
            onMouseEnter={() => !disabled && setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {hovered && showToolTip && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 text-xs font-medium text-white bg-black rounded">
                {percentage}%
              </div>
            )}
          </div>
        </Slider.Thumb>
      </Slider.Root>
    </div>
  );
}
