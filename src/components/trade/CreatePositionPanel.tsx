import { create } from "zustand";
import {
  AMOUNTS_TO_OPEN_DLMM_POSITION,
  CollateralDepositInput,
  MaxBalance,
} from "../CollateralDepositInput";
import { Row } from "../ui/Row";
import { useConvexUser } from "~/providers/UserStates";
import { Address, mints, tokensMetadata } from "../../../convex/utils/solana";
import { MnMSuspense } from "../MnMSuspense";
import { Skeleton } from "../ui/Skeleton";
import {
  BinDistribution,
  BinDistributionSkeleton,
  LiquidityShape,
} from "../BinDistribution";
import { AssetSplit, AssetSplitSkelton } from "../AssetSplitSlider";
import { useCreatePositionRangeStore } from "./RangeSelectorPanel";
import { useEffect, useState } from "react";
import { useBinsAroundActiveBin } from "~/states/dlmm";
import { useRouterState } from "@tanstack/react-router";
import { useTokenBalance } from "~/states/balances";
import { Button } from "../ui/Button";
import {
  ConfirmPositionContent,
  ConfirmPositionContentSkeleton,
} from "./ConfirmPositionModal";
import { Doc } from "../../../convex/_generated/dataModel";
import { Modal } from "../ui/Modal";
import {
  LeverageSlider,
  LeverageSliderCreatePosition,
  LeverageSliderSkeleton,
} from "../LeverageSlider";
import { LimitOrderValues } from "../LimitOrdersModal";
import { LabelValue } from "../ui/labelValueRow";
import { LimitOrderInput } from "../../../convex/schema/limitOrders";
import { RefreshTokenBalancesIcon } from "../RefreshBalanceIcon";

export type CreatePositionState = {
  collateralMint: Address;
  collateralUiAmount: number;

  liquidityShape: LiquidityShape;
  tokenXSplit: number;

  leverage: number;

  sl?: LimitOrderInput;
  tp?: LimitOrderInput;
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
  leverage: 1,
  sl: undefined,
  tp: undefined,
};

export const useCreatePositionState = create<CreatePositionStore>((set) => ({
  ...defaultCreatePositionState,

  setCreatePositionState: (newState) =>
    set((state) => ({ ...state, ...newState })),

  resetCreatePositionState: () =>
    set(() => ({ ...defaultCreatePositionState })),
}));

export function CreatePositionPanel({ poolAddress }: { poolAddress: Address }) {
  const { convexUser } = useConvexUser();
  const {
    collateralMint,
    collateralUiAmount,
    tokenXSplit,
    liquidityShape,
    leverage,
    sl,
    tp,
    setCreatePositionState,
    resetCreatePositionState,
  } = useCreatePositionState();
  const { lowerBin, upperBin, updateUpperLowerBins } =
    useCreatePositionRangeStore();

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

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
      updateUpperLowerBins({
        newUpper: activeBinObj,
        newLower: bins[activeBinIndex - totalBins + 1],
      });
    }
    if (tokenXSplit === 1) {
      updateUpperLowerBins({
        newLower: activeBinObj,
        newUpper: bins[activeBinIndex + totalBins - 1],
      });
    }
  }, [tokenXSplit]);

  useEffect(() => {
    setCreatePositionState({ leverage: 1 });
  }, [collateralMint]);
  useEffect(() => {
    resetCreatePositionState();
  }, [pathname, poolAddress]);

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <Row fullWidth className="mb-2.5">
        <Row className="gap-1.5">
          <div className="text-text text-sm">Collateral</div>
          {convexUser && (
            <RefreshTokenBalancesIcon
              className="h-3"
              userAddress={convexUser?.address}
            />
          )}
        </Row>
        {convexUser && (
          <MnMSuspense fallback={<Skeleton className="w-12 h-3" />}>
            <MaxBalance
              mint={collateralMint}
              userAddress={convexUser.address}
              onClick={(b) => {
                const maxAmount =
                  b.symbol === "SOL"
                    ? Math.max(
                        0.000001,
                        b.balance - AMOUNTS_TO_OPEN_DLMM_POSITION,
                      )
                    : b.balance;
                setCreatePositionState({ collateralUiAmount: maxAmount });
              }}
            />
          </MnMSuspense>
        )}
      </Row>
      <div className="flex flex-col gap-1">
        <CollateralDepositInput
          initialCollateralMint={defaultCreatePositionState.collateralMint}
          value={collateralUiAmount}
          onCollateralAmountChange={(amount) =>
            setCreatePositionState({ collateralUiAmount: amount })
          }
          onCollateralMintChange={(newMint) =>
            setCreatePositionState({ collateralMint: newMint })
          }
        />
        {convexUser && collateralUiAmount > 0 ? (
          <MnMSuspense fallback={<LeverageSliderSkeleton />}>
            <LeverageSliderCreatePosition
              userAddress={convexUser.address}
              poolAddress={poolAddress}
            />
          </MnMSuspense>
        ) : (
          <LeverageSlider leverage={1} maxLeverage={0} disabled />
        )}
      </div>

      {/*Bin dis */}
      <div className="text-text text-sm text-left mb-2.5 mt-4">
        Set Bin Distribution
      </div>
      <MnMSuspense fallback={<BinDistributionSkeleton />}>
        <BinDistribution
          poolAddress={poolAddress}
          collateralMint={collateralMint}
          collateralUiAmount={collateralUiAmount}
          lowerBin={lowerBin}
          upperBin={upperBin}
          tokenXSplit={tokenXSplit}
          liquidityShape={liquidityShape}
          onRangeChange={updateUpperLowerBins}
          onLiquidityShapeChange={(s) =>
            setCreatePositionState({ liquidityShape: s })
          }
        />
      </MnMSuspense>

      <div className="text-text text-sm text-left mb-2.5 mt-4">
        Set Asset Split
      </div>
      <MnMSuspense fallback={<AssetSplitSkelton />}>
        <AssetSplit
          poolAddress={poolAddress}
          collateralAmount={collateralUiAmount * leverage}
          collateralMint={collateralMint}
          tokenXSplit={tokenXSplit}
          lowerBin={lowerBin}
          upperBin={upperBin}
          onSplitChange={(newSplitX) =>
            setCreatePositionState({ tokenXSplit: newSplitX })
          }
        />
      </MnMSuspense>

      <div className="flex w-full bg-white/5 h-px my-2.5" />
      <LabelValue
        variant="row"
        labelClassName="text-text text-sm"
        label={"Stop Loss/Take Profit"}
        value={
          <LimitOrderValues
            poolAddress={poolAddress}
            sl={sl}
            tp={tp}
            onSaveOrders={(sl, tp) => setCreatePositionState({ sl, tp })}
          />
        }
      />

      {convexUser ? (
        <CreatePositionButton
          poolAddress={poolAddress}
          convexUser={convexUser}
          collateralMint={collateralMint}
          collateralUiAmount={collateralUiAmount}
        />
      ) : (
        <Button variant="liquidPrimary" className="mb-0 mt-4" disabled={true}>
          Wallet Not Connected
        </Button>
      )}
    </div>
  );
}

function CreatePositionButton({
  poolAddress,
  collateralMint,
  collateralUiAmount,
  convexUser,
}: {
  poolAddress: Address;
  convexUser: Doc<"users">;
  collateralMint: Address;
  collateralUiAmount: number;
}) {
  const { lowerBin, upperBin } = useCreatePositionRangeStore();
  const [confirmationModal, setConfirmationModal] = useState(false);
  const collateralTokenBalance = useTokenBalance({
    address: convexUser.address,
    mint: collateralMint,
  });

  const solBalance = useTokenBalance({
    address: convexUser.address,
    mint: mints.sol,
  });

  const insufficientBalance =
    collateralUiAmount > collateralTokenBalance.balance;

  // 2. Rent requirement — different per token type
  const notEnoughForRent =
    collateralMint === mints.sol
      ? // SOL deposit → rent taken from the same balance
        solBalance.balance < collateralUiAmount + AMOUNTS_TO_OPEN_DLMM_POSITION
      : // USDC deposit → rent still needs SOL
        solBalance.balance < AMOUNTS_TO_OPEN_DLMM_POSITION;

  const disableButton =
    collateralUiAmount <= 0 ||
    insufficientBalance ||
    notEnoughForRent ||
    !lowerBin ||
    !upperBin;

  return (
    <>
      <Button
        variant="liquidPrimary"
        className="mb-0 mt-4"
        onClick={() => setConfirmationModal(true)}
        disabled={disableButton}
      >
        {insufficientBalance
          ? `Insufficient ${tokensMetadata[collateralMint].symbol}`
          : notEnoughForRent
            ? "Insufficient funds for rent"
            : "Create position"}
      </Button>

      <Modal
        title={"Confirm Position"}
        main={
          <MnMSuspense fallback={<ConfirmPositionContentSkeleton />}>
            <ConfirmPositionContent
              convexUser={convexUser}
              poolAddress={poolAddress}
              onClose={() => setConfirmationModal(false)}
            />
          </MnMSuspense>
        }
        show={confirmationModal}
        onClose={() => setConfirmationModal(false)}
      />
    </>
  );
}
export function CreatePositionPanelSkeleton() {
  return (
    <div className="flex flex-col w-full h-full ">
      <Row fullWidth className="mb-2.5">
        <div className="text-text text-sm">Collateral</div>
        <Skeleton className="w-12 h-3" />
      </Row>

      <div className="flex flex-col gap-1">
        <CollateralDepositInput
          initialCollateralMint={defaultCreatePositionState.collateralMint}
          value={0}
          onCollateralAmountChange={() => {}}
          onCollateralMintChange={() => {}}
        />
        <LeverageSliderSkeleton />
      </div>
      {/*Bin dis */}
      <div className="text-text text-sm text-left mb-2.5 mt-4">
        Set Bin Distribution
      </div>
      <BinDistributionSkeleton />

      <div className="text-text text-sm text-left mb-2.5 mt-4">
        Set Asset Split
      </div>
      <AssetSplitSkelton />

      <Button variant="liquidPrimary" className="mb-0 mt-4" disabled>
        Create Position
      </Button>
    </div>
  );
}
