import { create } from "zustand";
import { AMOUNTS_TO_OPEN_DLMM_POSITION, CollateralDepositInput, MaxBalance } from "../CollateralDepositInput";
import { Row } from "../ui/Row";
import { useConvexUser } from "~/providers/UserStates";
import { Address, mints } from "../../../convex/utils/solana";
import { MnMSuspense } from "../MnMSuspense";
import { Skeleton } from "../ui/Skeleton";
import { BinDistribution } from "../BinDistribution";

export type CreatePositionState = {
  collateralMint: Address;
  collateralUiAmount: number;
};

export type CreatePositionStore = CreatePositionState & {
  setCreatePositionState: (newState: Partial<CreatePositionState>) => void;
  resetCreatePositionState: () => void;
};

const defaultCreatePositionState: CreatePositionState = {
  collateralMint: mints.usdc,
  collateralUiAmount: 0,
};

export const useCreatePositionState = create<CreatePositionStore>((set) => ({
  ...defaultCreatePositionState,

  setCreatePositionState: (newState) => set((state) => ({ ...state, ...newState })),

  resetCreatePositionState: () => set(() => ({ ...defaultCreatePositionState })),
}));

export function CreatePositionPanel({ poolAddress }: { poolAddress: Address }) {
  const { convexUser } = useConvexUser();
  const { collateralMint, collateralUiAmount, setCreatePositionState } = useCreatePositionState();
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
      <BinDistribution poolAddress={poolAddress} onLiquidityShapeChange={() => {}} />
    </div>
  );
}
