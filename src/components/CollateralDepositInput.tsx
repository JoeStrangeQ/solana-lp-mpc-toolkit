import { useEffect, useRef, useState } from "react";
import { Address, mints, tokensMetadata } from "../../convex/utils/solana";
import { useTokenPrice } from "~/states/tokens";
import { formatAmountInputWithSeparators, formatTokenAmount, formatUsdValue } from "~/utils/numberFormats";
import { useTokenBalance } from "~/states/balances";
import { motion } from "motion/react";
import { RENT_LAMPORTS_DLMM } from "../../convex/services/meteora";
import { useConvexUser } from "~/providers/UserStates";
import { rawAmountToAmount } from "../../convex/utils/amounts";
import { SlidingSelect } from "./ui/SlidingSelector";
import { TokenIcon } from "./TokenIcon";
import { MnMSuspense } from "./MnMSuspense";
import { Skeleton } from "./ui/Skeleton";
import { Row } from "./ui/Row";
import { WalletMinimal } from "lucide-react";
import { TokenBalance } from "../../convex/actions/fetch/walletBalances";

const ESTIMATE_NOZOMI_TIP = 1_050_000 * 3;

export const AMOUNTS_TO_OPEN_DLMM_POSITION =
  rawAmountToAmount(RENT_LAMPORTS_DLMM, 9) + rawAmountToAmount(ESTIMATE_NOZOMI_TIP, 9);
export function CollateralDepositInput({
  initialCollateralMint = mints.usdc,
  value,
  onCollateralAmountChange,
  onCollateralMintChange,
}: {
  initialCollateralMint?: Address;
  value?: number;
  onCollateralAmountChange?: (amount: number) => void;
  onCollateralMintChange?: (newMint: Address) => void;
}) {
  const { convexUser } = useConvexUser();
  const [collateralMint, setCollateralMint] = useState<Address>(initialCollateralMint);
  const [depositAmount, setDepositAmount] = useState("");

  const lastExternalValue = useRef<number | undefined>(undefined);
  useEffect(() => {
    // Ignore the effect firing on mount:
    if (lastExternalValue.current === value) return;

    lastExternalValue.current = value;

    // If the external value is 0 but user is editing, do NOT override input
    if (value === 0 && depositAmount !== "") return;

    // Otherwise sync external value
    setDepositAmount(value === undefined || value === 0 ? "" : String(value));
  }, [value]);

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex flex-row items-center justify-between bg-backgroundTertiary inner-white rounded-2xl px-3.5 py-4">
        <div className="flex flex-col">
          <input
            type="text"
            value={formatAmountInputWithSeparators(depositAmount)}
            onChange={(e) => {
              const input = e.target.value.replaceAll(",", "");
              if (isNaN(Number(input))) return;
              setDepositAmount(input);
              onCollateralAmountChange?.(Number(input));
            }}
            placeholder="0.00"
            className="text-text placeholder:text-textSecondary outline-none w-full"
          />
          {convexUser ? (
            <MnMSuspense fallback={<Skeleton className="h-4 w-14" />}>
              <DepositedUsdAmount
                userAddress={convexUser.address}
                depositUiAmount={Number(depositAmount)}
                collateralMint={collateralMint}
              />
            </MnMSuspense>
          ) : (
            <div className="text-textSecondary text-xs">Please Connect Wallet</div>
          )}
        </div>

        <SlidingSelect
          options={[
            { id: mints.usdc, element: <TokenIcon className="w-5 h-5" icon={tokensMetadata[mints.usdc].icon} /> },
            { id: mints.sol, element: <TokenIcon className="w-5 h-5" icon={tokensMetadata[mints.sol].icon} /> },
          ]}
          value={collateralMint}
          onChange={(newMint) => {
            setCollateralMint(newMint);
            onCollateralMintChange?.(newMint);
          }}
        />
      </div>
    </div>
  );
}

function DepositedUsdAmount({
  userAddress,
  depositUiAmount,
  collateralMint,
}: {
  userAddress: string;
  depositUiAmount: number;
  collateralMint: Address;
}) {
  const collateralTokenPrice = useTokenPrice({ mint: collateralMint });

  const collateralTokenBalance = useTokenBalance({
    address: userAddress,
    mint: collateralMint,
  });

  const solBalance = useTokenBalance({
    address: userAddress,
    mint: mints.sol,
  });

  const formattedDepositedUsdValue = formatUsdValue(depositUiAmount * collateralTokenPrice);

  // 1. Normal insufficient balance for the selected token
  const insufficientBalance = depositUiAmount > collateralTokenBalance.balance;

  // 2. Rent requirement — different per token type
  const notEnoughForRent =
    collateralMint === mints.sol
      ? // SOL deposit → rent taken from the same balance
        solBalance.balance < depositUiAmount + AMOUNTS_TO_OPEN_DLMM_POSITION
      : // USDC deposit → rent still needs SOL
        solBalance.balance < AMOUNTS_TO_OPEN_DLMM_POSITION;

  if (insufficientBalance && depositUiAmount > 0) {
    return (
      <motion.div
        key="deposit-too-high"
        className="text-red text-xs"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        Insufficient {collateralTokenBalance.symbol}
      </motion.div>
    );
  }

  if (notEnoughForRent && depositUiAmount > 0) {
    return (
      <motion.div
        key="not-enough-rent"
        className="text-yellow text-xs"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        Insufficient SOL for rent
      </motion.div>
    );
  }

  return <div className="text-textSecondary text-xs">{depositUiAmount > 0 ? formattedDepositedUsdValue : "$0.00"}</div>;
}

export function MaxBalance({
  userAddress,
  mint,
  onClick,
}: {
  userAddress: Address;
  mint: Address;
  onClick?: (tokenBalance: TokenBalance) => void;
}) {
  const collateralTokenBalance = useTokenBalance({
    address: userAddress,
    mint,
  });

  return (
    <Row
      justify="start"
      className="gap-1 select-none cursor-pointer group hover:text-text active:scale-95  hover-effect"
      onClick={() => onClick?.(collateralTokenBalance)}
    >
      <WalletMinimal className="w-3 h-3 text-textSecondary group-hover:text-text hover-effect" />
      <div className="text-textSecondary text-xs group-hover:text-text hover-effect">
        {formatTokenAmount(collateralTokenBalance.balance, collateralTokenBalance.symbol)}
      </div>
    </Row>
  );
}
