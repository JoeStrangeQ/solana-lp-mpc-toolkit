import { create } from "zustand";
import { AMOUNTS_TO_OPEN_DLMM_POSITION, CollateralDepositInput, MaxBalance } from "../CollateralDepositInput";
import { Row } from "../ui/Row";
import { useConvexUser } from "~/providers/UserStates";
import { Address, mints } from "../../../convex/utils/solana";
import { MnMSuspense } from "../MnMSuspense";
import { Skeleton } from "../ui/Skeleton";
import { BinDistribution, LiquidityShape } from "../BinDistribution";
import { AssetSplit } from "../AssetSplitSlider";
import { useCreatePositionRangeStore } from "./RangeSelectorPanel";
import { useEffect } from "react";
import { useBinsAroundActiveBin } from "~/states/dlmm";

export type CreatePositionState = {
  collateralMint: Address;
  collateralUiAmount: number;

  liquidityShape: LiquidityShape;
  tokenXSplit: number;
};

export type CreatePositionStore = CreatePositionState & {
  setCreatePositionState: (newState: Partial<CreatePositionState>) => void;
  resetCreatePositionState: () => void;
};

const defaultCreatePositionState: CreatePositionState = {
  collateralMint: mints.usdc,
  collateralUiAmount: 0,
  tokenXSplit: 0.5,
  liquidityShape: "Spot",
};

export const useCreatePositionState = create<CreatePositionStore>((set) => ({
  ...defaultCreatePositionState,

  setCreatePositionState: (newState) => set((state) => ({ ...state, ...newState })),

  resetCreatePositionState: () => set(() => ({ ...defaultCreatePositionState })),
}));

export function CreatePositionPanel({ poolAddress }: { poolAddress: Address }) {
  const { convexUser } = useConvexUser();
  const { collateralMint, collateralUiAmount, tokenXSplit, liquidityShape, setCreatePositionState } =
    useCreatePositionState();
  const { lowerBin, upperBin, updateUpperLowerBins } = useCreatePositionRangeStore();

  const {
    binRange: { bins, activeBin },
  } = useBinsAroundActiveBin({
    poolAddress,
    numberOfBinsToTheLeft: 124,
    numberOfBinsToTheRight: 124,
  });

  useEffect(() => {
    if (!lowerBin || !upperBin) return;
    if (lowerBin.binId >= activeBin) {
      setCreatePositionState({ tokenXSplit: 1 });
    }

    if (upperBin.binId <= activeBin) {
      setCreatePositionState({ tokenXSplit: 0 });
    }
  }, [lowerBin, upperBin, activeBin]);

  useEffect(() => {
    if (bins.length === 0) return;
    if (!lowerBin || !upperBin) return;
    const totalBins = Math.max(0, upperBin.binId - lowerBin.binId + 1);

    const activeBinIndex = bins.findIndex((b) => b.binId === activeBin);
    if (activeBinIndex === -1) return;

    const activeBinObj = bins[activeBinIndex];
    if (tokenXSplit === 0) {
      updateUpperLowerBins({ newUpper: activeBinObj, newLower: bins[activeBinIndex - totalBins + 1] });
    }
    if (tokenXSplit === 1) {
      updateUpperLowerBins({ newLower: activeBinObj, newUpper: bins[activeBinIndex + totalBins - 1] });
    }
  }, [tokenXSplit]);

  return (
    <div className="flex flex-col w-full">
      <Row fullWidth className="mb-3">
        <div className="text-text text-sm">Collateral</div>
        {convexUser && (
          <MnMSuspense fallback={<Skeleton className="w-12 h-3" />}>
            <MaxBalance
              mint={collateralMint}
              userAddress={convexUser.address}
              onClick={(b) => {
                const maxAmount = b.symbol === "SOL" ? b.balance - AMOUNTS_TO_OPEN_DLMM_POSITION : b.balance;
                setCreatePositionState({ collateralUiAmount: maxAmount });
              }}
            />
          </MnMSuspense>
        )}
      </Row>
      <CollateralDepositInput
        initialCollateralMint={defaultCreatePositionState.collateralMint}
        value={collateralUiAmount}
        onCollateralAmountChange={(amount) => setCreatePositionState({ collateralUiAmount: amount })}
        onCollateralMintChange={(newMint) => setCreatePositionState({ collateralMint: newMint })}
      />

      {/*Bin dis */}
      <div className="text-text text-sm text-left mb-3 mt-5">Set Bin Distribution</div>
      <BinDistribution
        poolAddress={poolAddress}
        collateralMint={collateralMint}
        collateralUiAmount={collateralUiAmount}
        lowerBin={lowerBin}
        upperBin={upperBin}
        tokenXSplit={tokenXSplit}
        liquidityShape={liquidityShape}
        onRangeChange={updateUpperLowerBins}
        onLiquidityShapeChange={(s) => setCreatePositionState({ liquidityShape: s })}
      />

      <div className="text-text text-sm text-left mb-3 mt-5">Set Asset Split</div>
      <AssetSplit
        poolAddress={poolAddress}
        collateralAmount={collateralUiAmount}
        collateralMint={collateralMint}
        tokenXSplit={tokenXSplit}
        lowerBin={lowerBin}
        upperBin={upperBin}
        onSplitChange={(newSplitX) => setCreatePositionState({ tokenXSplit: newSplitX })}
      />
    </div>
  );
}
