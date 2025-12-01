import { usePool } from "~/states/pools";
import { useToken, useTokenPrice } from "~/states/tokens";
import { cn } from "~/utils/cn";
import { abbreviateAmount, formatTokenAmount, formatUsdValue } from "~/utils/numberFormats";
import { Doc } from "../../../convex/_generated/dataModel";
import { Address, toAddress } from "../../../convex/utils/solana";
import { PoolTokenIcons, TokenIcon } from "../TokenIcon";
import { LabelValue } from "../ui/labelValueRow";
import { Row } from "../ui/Row";
import { BinIdAndPrice, PositionTokenAmount } from "../../../convex/schema/positions";
import { rawAmountToAmount } from "../../../convex/utils/amounts";
import { useDlmmOnChainPosition } from "~/states/positions";
import { FormattedBinPrice } from "../FormattedBinPrice";
import { PenLine } from "lucide-react";
import { TableRow, TableCell } from "../ui/Table";
import { Skeleton } from "../ui/Skeleton";
import { MnMSuspense } from "../MnMSuspense";

export function DlmmOpenPositionRow({ dbPosition }: { dbPosition: Doc<"positions"> }) {
  const poolAddress = toAddress(dbPosition.poolAddress);
  const positionPubkey = toAddress(dbPosition.positionPubkey);

  return (
    <TableRow>
      <TableCell>
        <MnMSuspense fallback={<PoolSkeleton />}>
          <Pool poolAddress={poolAddress} />
        </MnMSuspense>
      </TableCell>

      <TableCell>
        <Collateral collateral={dbPosition.collateral} />
      </TableCell>

      <TableCell>
        <MnMSuspense fallback={<SizeSkeleton />}>
          <Size
            poolAddress={poolAddress}
            positionPubkey={positionPubkey}
            xDb={dbPosition.tokenX}
            yDb={dbPosition.tokenY}
            state="current"
          />
        </MnMSuspense>
      </TableCell>

      <TableCell>
        <MnMSuspense fallback={<TwoLinesSkeleton />}>
          <Range
            poolAddress={poolAddress}
            lowerBin={dbPosition.details.lowerBin}
            upperBin={dbPosition.details.upperBin}
          />
        </MnMSuspense>
      </TableCell>

      <TableCell>
        <MnMSuspense fallback={<TwoLinesSkeleton />}>
          <PoolPrice poolAddress={poolAddress} poolEntryPrice={dbPosition.poolEntryPrice} />
        </MnMSuspense>
      </TableCell>

      {/* <TableCell>
        <Liquidation poolAddress={poolAddress} />
      </TableCell>

      <TableCell>
        <LimitOrders poolAddress={poolAddress} />
      </TableCell> */}

      <TableCell>
        <MnMSuspense fallback={<TwoLinesSkeleton />}>
          <ClaimableFees poolAddress={poolAddress} positionPubkey={positionPubkey} />
        </MnMSuspense>
      </TableCell>

      <TableCell>
        <MnMSuspense fallback={<TwoLinesSkeleton />}>
          <PnL
            poolAddress={poolAddress}
            positionPubkey={positionPubkey}
            xDb={dbPosition.tokenX}
            yDb={dbPosition.tokenY}
          />
        </MnMSuspense>
      </TableCell>
    </TableRow>
  );
}

function Pool({ poolAddress, leverage = 1 }: { poolAddress: Address; leverage?: number }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });
  return (
    <Row justify="start" className="gap-1.5">
      <PoolTokenIcons size={28} xIcon={tokenX.icon} yIcon={tokenY.icon} dex="Meteora" />
      <div className="flex flex-col">
        <Row justify="start" className="gap-1">
          <div className="text-text text-sm">{pool.name}</div>
          <div
            className={cn(
              "flex px-2 py-px rounded-full text-xs ",
              leverage > 1 ? "bg-primary/10 text-primary" : "bg-white/10 text-text"
            )}
          >
            x{leverage}
          </div>
        </Row>
        <Row justify="start" className="gap-1">
          <LabelValue
            label={"Bin Step"}
            value={pool.bin_step}
            className="text-xs"
            valueClassName="text-xs"
            labelClassName="text-xs"
          />
          <LabelValue
            label={"B. Fee"}
            value={`${abbreviateAmount(pool.base_fee_percentage, { type: "percentage" })}%`}
            valueClassName="text-xs"
            labelClassName="text-xs"
          />
        </Row>
      </div>
    </Row>
  );
}

function PoolSkeleton() {
  return (
    <Row justify="start" className="gap-1.5">
      <PoolTokenIcons size={28} isLoading />
      <div className="flex flex-col">
        <Skeleton className="w-14 h-3.5" />
        <Row justify="start" className="gap-1">
          <LabelValue
            label={"Bin Step"}
            value={0}
            className="text-xs"
            valueClassName="text-xs"
            labelClassName="text-xs"
            isLoading
          />
          <LabelValue
            label={"B. Fee"}
            value={0}
            className="text-xs"
            valueClassName="text-xs"
            labelClassName="text-xs"
            isLoading
          />
        </Row>
      </div>
    </Row>
  );
}

function TwoLinesSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-3 w-10" />
    </div>
  );
}
function Collateral({ collateral }: { collateral: PositionTokenAmount }) {
  return (
    <MnMSuspense fallback={<TokenAmountDisplaySkeleton />}>
      <TokenAmountDisplay mint={toAddress(collateral.mint)} rawAmount={collateral.rawAmount} />
    </MnMSuspense>
  );
}

function SizeSkeleton() {
  return (
    <Row justify="start" className="gap-3.5">
      <TokenAmountDisplaySkeleton />
      <TokenAmountDisplaySkeleton />
    </Row>
  );
}
function Size({
  poolAddress,
  positionPubkey,
  xDb,
  yDb,
  state,
}: {
  poolAddress: Address;
  positionPubkey: Address;
  xDb: PositionTokenAmount;
  yDb: PositionTokenAmount;
  state: "initial" | "current";
}) {
  const xMint = toAddress(xDb.mint);
  const yMint = toAddress(yDb.mint);

  const tokenX = useToken({ mint: xMint });
  const tokenY = useToken({ mint: yMint });

  const xPrice = useTokenPrice({ mint: xMint });
  const yPrice = useTokenPrice({ mint: yMint });

  const onChainPosition = useDlmmOnChainPosition({
    poolAddress,
    positionPubkey,
  });
  if (!onChainPosition) return <SizeSkeleton />; // should return placeholder or skeleton here as this will happen when we loading the on chain position
  const { totalXAmount, totalYAmount } = onChainPosition;
  // Initial
  const initialX = rawAmountToAmount(xDb.rawAmount, tokenX.decimals);
  const initialY = rawAmountToAmount(yDb.rawAmount, tokenY.decimals);

  // Current
  const currentX = rawAmountToAmount(Number(totalXAmount), tokenX.decimals);
  const currentY = rawAmountToAmount(Number(totalYAmount), tokenY.decimals);

  const amountX = state === "current" ? currentX : initialX;
  const amountY = state === "current" ? currentY : initialY;

  const usdX = amountX * xPrice;
  const usdY = amountY * yPrice;

  const totalUsd = usdX + usdY;

  const pctX = (usdX / totalUsd) * 100;
  const pctY = (usdY / totalUsd) * 100;

  return (
    <Row justify="start" className="gap-3.5">
      <TokenAmountDisplay
        mint={xMint}
        rawAmount={state === "current" ? Number(totalXAmount) : xDb.rawAmount}
        pct={pctX}
      />

      <TokenAmountDisplay
        mint={yMint}
        rawAmount={state === "current" ? Number(totalYAmount) : yDb.rawAmount}
        pct={pctY}
      />
    </Row>
  );
}

function TokenAmountDisplay({ mint, rawAmount, pct }: { mint: Address; rawAmount: number; pct?: number }) {
  const token = useToken({ mint });
  const price = useTokenPrice({ mint });

  const amount = rawAmountToAmount(rawAmount, token.decimals);
  const usdValue = amount * price;

  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-0.5 text-text text-sm">
        <TokenIcon className="h-4 w-4" icon={token.icon} />
        {formatTokenAmount(amount, token.symbol)}
      </Row>

      <Row justify="start" className="gap-0.5">
        <div className="text-textSecondary text-xs">{formatUsdValue(usdValue)}</div>
        {pct !== undefined && (
          <div className="text-textSecondary/60 text-xs">
            {abbreviateAmount(pct, { type: "percentage", decimals: 0 })}%
          </div>
        )}
      </Row>
    </div>
  );
}

function TokenAmountDisplaySkeleton() {
  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-0.5 text-text text-sm">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-10 rounded-full" />
      </Row>

      <Skeleton className="h-3 w-16 rounded-full" />
    </div>
  );
}

function Range({
  poolAddress,
  lowerBin,
  upperBin,
}: {
  poolAddress: Address;
  lowerBin: BinIdAndPrice;
  upperBin: BinIdAndPrice;
}) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });

  const currentPrice = Number(pool.current_price);
  const isInRange = lowerBin.price <= currentPrice && upperBin.price >= currentPrice;
  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-0.5">
        <FormattedBinPrice value={lowerBin.price} classname="text-sm text-text font-normal" significantDigits={4} />
        <div className="text-sm text-text font-normal">-</div>
        <FormattedBinPrice value={upperBin.price} classname="text-sm text-text font-normal" significantDigits={4} />
      </Row>
      <div className={cn("text-xs", isInRange ? "text-green" : "text-red")}>
        {isInRange ? "In Range" : "Out Of Range"}
      </div>
    </div>
  );
}

function PoolPrice({ poolAddress, poolEntryPrice }: { poolAddress: Address; poolEntryPrice: number }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });

  const symbols = pool.name.split("-");
  const currentPrice = Number(pool.current_price);
  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-px">
        <FormattedBinPrice value={currentPrice} classname="text-sm text-text font-normal" significantDigits={4} />
        <div className="text-sm text-text font-normal">/</div>
        <FormattedBinPrice value={poolEntryPrice} classname="text-sm text-text font-normal" significantDigits={4} />
      </Row>
      <div className="text-xs text-textSecondary">
        {symbols[0]}/{symbols[1]}
      </div>
    </div>
  );
}

function Liquidation({ poolAddress }: { poolAddress: Address }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });

  const symbols = pool.name.split("-");

  const upperLiqPriceUp = 0;
  const lowerLiqPrice = 0;

  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-px">
        {lowerLiqPrice === 0 ? (
          <div className="text-sm text-textSecondary font-normal">--</div>
        ) : (
          <FormattedBinPrice value={lowerLiqPrice} classname="text-sm text-red font-normal" significantDigits={4} />
        )}
        <div className="text-sm text-text font-normal">/</div>
        {upperLiqPriceUp === 0 ? (
          <div className="text-sm text-textSecondary font-normal">--</div>
        ) : (
          <FormattedBinPrice value={upperLiqPriceUp} classname="text-sm text-red font-normal" significantDigits={4} />
        )}
      </Row>
      <div className="text-xs text-textSecondary">
        {symbols[0]}/{symbols[1]}
      </div>
    </div>
  );
}

function LimitOrders({ poolAddress }: { poolAddress: Address }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });

  const symbols = pool.name.split("-");

  const upperLimit = 0;
  const lowerLimit = 0;

  return (
    <div className="flex flex-col">
      <Row justify="start" className="group gap-px cursor-pointer ">
        {lowerLimit === 0 ? (
          <div className="text-sm text-textSecondary group-hover:text-text font-normal hover-effect">--</div>
        ) : (
          <FormattedBinPrice
            value={lowerLimit}
            classname="text-sm text-text group-hover:text-text font-normal hover-effect"
            significantDigits={4}
          />
        )}

        <div className="text-sm text-text group-hover:text-text font-normal hover-effect">/</div>

        {upperLimit === 0 ? (
          <div className="text-sm text-textSecondary group-hover:text-text font-normal hover-effect">--</div>
        ) : (
          <FormattedBinPrice
            value={upperLimit}
            classname="text-sm text-text group-hover:text-text font-normal hover-effect"
            significantDigits={4}
          />
        )}

        <PenLine className="w-2.5 h-2.5 ml-1 text-textSecondary group-hover:text-text hover-effect" />
      </Row>
      <div className="text-xs text-textSecondary hover-effect">
        {symbols[0]}/{symbols[1]}
      </div>
    </div>
  );
}

function ClaimableFees({ poolAddress, positionPubkey }: { poolAddress: Address; positionPubkey: Address }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });

  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  const xPrice = useTokenPrice({ mint: pool.mint_x });
  const yPrice = useTokenPrice({ mint: pool.mint_y });
  const onChainPosition = useDlmmOnChainPosition({
    poolAddress,
    positionPubkey,
  });
  if (!onChainPosition) return <TwoLinesSkeleton />; // should return placeholder or skeleton here as this will happen when we loading the on chain position
  const { feeX, feeY } = onChainPosition;

  const xFee = rawAmountToAmount(Number(feeX), tokenX.decimals);
  const yFee = rawAmountToAmount(Number(feeY), tokenY.decimals);

  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-0.5 text-text text-sm">
        <TokenIcon className="h-4 w-4" icon={tokenX.icon} />
        {formatTokenAmount(xFee, tokenX.symbol)}
        <div className="text-textSecondary text-xs">{formatUsdValue(xFee * xPrice)}</div>
      </Row>

      <Row justify="start" className="gap-0.5 text-text text-sm">
        <TokenIcon className="h-4 w-4" icon={tokenY.icon} />
        {formatTokenAmount(yFee, tokenX.symbol)}
        <div className="text-textSecondary text-xs">{formatUsdValue(yFee * yPrice)}</div>
      </Row>
    </div>
  );
}

function PnL({
  poolAddress,
  positionPubkey,
  xDb,
  yDb,
}: {
  poolAddress: Address;
  positionPubkey: Address;
  xDb: PositionTokenAmount;
  yDb: PositionTokenAmount;
}) {
  const xMint = toAddress(xDb.mint);
  const yMint = toAddress(yDb.mint);

  const tokenX = useToken({ mint: xMint });
  const tokenY = useToken({ mint: yMint });

  const xPrice = useTokenPrice({ mint: xMint });
  const yPrice = useTokenPrice({ mint: yMint });

  const onChainPosition = useDlmmOnChainPosition({
    poolAddress,
    positionPubkey,
  });
  if (!onChainPosition) return <TwoLinesSkeleton />; // should return placeholder or skeleton here as this will happen when we loading the on chain position
  const { feeX, feeY, totalXAmount, totalYAmount } = onChainPosition;

  // -----------------------------
  // Initial USD (from DB snapshot)
  // -----------------------------
  const initialXAmount = rawAmountToAmount(xDb.rawAmount, tokenX.decimals);
  const initialYAmount = rawAmountToAmount(yDb.rawAmount, tokenY.decimals);
  const initialXUsd = initialXAmount * xDb.usdPrice;
  const initialYUsd = initialYAmount * yDb.usdPrice;

  const totalUsdInitial = initialXUsd + initialYUsd;

  // -----------------------------
  // Current USD (from on-chain)
  // -----------------------------
  const currentXAmount = rawAmountToAmount(Number(totalXAmount), tokenX.decimals);
  const currentYAmount = rawAmountToAmount(Number(totalYAmount), tokenY.decimals);

  const currentXUsd = currentXAmount * xPrice;
  const currentYUsd = currentYAmount * yPrice;

  const totalUsdCurrent = currentXUsd + currentYUsd;

  // -----------------------------
  // Fee USD (from on-chain)
  // -----------------------------
  const feeXAmount = rawAmountToAmount(Number(feeX), tokenX.decimals);
  const feeYAmount = rawAmountToAmount(Number(feeY), tokenY.decimals);

  const xFeeUsd = feeXAmount * xPrice;
  const yFeeUsd = feeYAmount * yPrice;

  const unrealizedFeesUsd = xFeeUsd + yFeeUsd;

  // -----------------------------
  // Realized vs Unrealized
  // [We track claimed fees separately later]
  // -----------------------------
  const realizedFeesUsd = 0; // TODO: modify when claim fees is live
  //we will have add liquidity and remove liquidity here

  // Unrealized PnL includes:
  // - the current value of the position
  // - the unclaimed fees
  const unrealizedPnlUsd = totalUsdCurrent + unrealizedFeesUsd - totalUsdInitial;

  // Total PnL = realized + unrealized
  const pnlUsd = realizedFeesUsd + unrealizedPnlUsd;

  // % PnL — avoid division by zero
  const pnlPct = totalUsdInitial > 0 ? (pnlUsd / totalUsdInitial) * 100 : 0;

  const isProfit = pnlUsd >= 0;

  return (
    <div className="flex flex-col">
      <Row justify="start" className="gap-1">
        {/* PnL in USD */}
        <div className={cn("text-sm", isProfit ? "text-green" : "text-red")}>{formatUsdValue(pnlUsd)}</div>

        {/* PnL percentage */}
        <div
          className={cn(
            "flex px-2 py-px rounded-full text-xs",
            isProfit ? "text-green bg-green/10" : "text-red bg-red/10"
          )}
        >
          {abbreviateAmount(pnlPct, { type: "percentage" })}%
        </div>
      </Row>

      {/* Fees */}
      <div className="text-textSecondary text-xs">{formatUsdValue(unrealizedFeesUsd)} in fees</div>
    </div>
  );
}
