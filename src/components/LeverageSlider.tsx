import * as Slider from "@radix-ui/react-slider";
import { motion } from "motion/react";
import { ReactNode, useState } from "react";
import { Address } from "../../convex/utils/solana";
import { useLoopscaleQuote } from "~/states/loopscale";
import { useCreatePositionState } from "./trade/CreatePositionPanel";
import { cn } from "~/utils/cn";
import { Skeleton } from "./ui/Skeleton";
import { usePool } from "~/states/pools";
import { useCollateralToTokenAmount, useToken } from "~/states/tokens";
import { Row } from "./ui/Row";
import { TokenIcon } from "./TokenIcon";
import { formatTokenAmount, formatUsdValue } from "~/utils/numberFormats";

export function LeverageSliderCreatePosition({
  userAddress,
  poolAddress,
}: {
  userAddress: Address;
  poolAddress: Address;
}) {
  const {
    collateralMint,
    collateralUiAmount,
    tokenXSplit,
    leverage,
    setCreatePositionState,
  } = useCreatePositionState();
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  const { maxLeverage } = useLoopscaleQuote({
    userAddress,
    collateralMint,
    collateralUiAmount,
    poolAddress,
    tokenXSplit,
  });
  const { tokenAmount: xAmount, tokenUsdAmount: xUsdAmount } =
    useCollateralToTokenAmount({
      collateralMint,
      collateralAmount: collateralUiAmount,
      mint: pool.mint_x,
      split: tokenXSplit,
    });
  const { tokenAmount: yAmount, tokenUsdAmount: yUsdAmount } =
    useCollateralToTokenAmount({
      collateralMint,
      collateralAmount: collateralUiAmount,
      mint: pool.mint_y,
      split: 1 - tokenXSplit,
    });

  const xBorrowed = xAmount * leverage - xAmount;
  const xBorrowedUsd = xUsdAmount * leverage - xUsdAmount;
  const yBorrowed = yAmount * leverage - yAmount;
  const yBorrowedUsd = yUsdAmount * leverage - yUsdAmount;

  return (
    <LeverageSlider
      leverage={leverage}
      maxLeverage={Math.min(5, maxLeverage)}
      onLeverageChange={(newLev) =>
        setCreatePositionState({ leverage: newLev })
      }
      toolTip={
        <div className="flex flex-col gap-0.5 grow min-w-32">
          <div className="text-textSecondary text-xs mb-0.5">Borrowing</div>
          <Row fullWidth justify="between" className="gap-5">
            <Row justify="start" className="gap-0.5 text-text text-xs">
              <TokenIcon className="h-2.5 w-2.5" icon={tokenX.icon} />
              {formatTokenAmount(xBorrowed, tokenX.symbol)}
            </Row>
            <div className="flex ml-auto mr-0 text-textSecondary text-xs">
              {formatUsdValue(xBorrowedUsd)}
            </div>
          </Row>

          <Row fullWidth justify="between" className="gap-5">
            <Row justify="start" className="gap-0.5 text-text text-xs">
              <TokenIcon className="h-2.5 w-2.5" icon={tokenY.icon} />
              {formatTokenAmount(yBorrowed, tokenY.symbol)}
            </Row>
            <div className="flex ml-auto mr-0 text-textSecondary text-xs">
              {formatUsdValue(yBorrowedUsd)}
            </div>
          </Row>
        </div>
      }
    />
  );
}

export function LeverageSliderSkeleton() {
  return (
    <div className="flex bg-backgroundTertiary inner-white rounded-full px-2.5 py-1.5">
      <div className="relative w-full h-5 flex items-center">
        {/* Track Skeleton */}
        <Skeleton className="w-full h-1.5 rounded-full bg-white/5" />

        {/* Fake Thumb */}
        <Skeleton className="absolute left-4 -translate-x-1/2 h-4 w-8 bg-white/50 backdrop-blur-md rounded-full" />
      </div>
    </div>
  );
}
export function LeverageSlider({
  leverage,
  maxLeverage,
  disabled,
  toolTip,
  onLeverageChange,
}: {
  leverage: number;
  maxLeverage: number;
  disabled?: boolean;
  toolTip?: ReactNode;
  onLeverageChange?: (newLev: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="flex bg-backgroundTertiary inner-white rounded-full px-2.5 py-1.5  z-10">
      <Slider.Root
        className={cn(
          "relative flex items-center w-full h-5",
          disabled ? "opacity-15" : "opacity-100",
        )}
        min={1}
        max={maxLeverage}
        step={0.01}
        value={[leverage]}
        onValueChange={(v) => {
          onLeverageChange?.(v[0]);
        }}
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
        disabled={disabled || maxLeverage === 1}
      >
        <Slider.Track
          className={`bg-backgroundQuaternary relative grow rounded-full h-1.5`}
        >
          <Slider.Range
            className={`bg-white/20 absolute rounded-full h-full `}
          />
        </Slider.Track>

        <Slider.Thumb
          className={cn(
            "relative block px-1.5 py-0.5 bg-text/90  rounded-full shadow outline-0 ring-0 text-[10px] text-black hover-effect cursor-grab",
            !disabled && "hover:bg-text active:scale-110",
          )}
        >
          {leverage.toFixed(2)}x
          {isDragging && !disabled && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex select-none absolute bottom-6 left-1/2 -translate-x-1/2 z-20 p-1.5 rounded-xl bg-backgroundQuaternary backdrop-blur-2xl shadow-lg border border-white/10 pointer-events-none"
            >
              {toolTip}
            </motion.div>
          )}
        </Slider.Thumb>
      </Slider.Root>
    </div>
  );
}
