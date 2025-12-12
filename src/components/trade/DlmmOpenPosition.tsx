import { usePool } from "~/states/pools";
import { cn } from "~/utils/cn";
import { abbreviateAmount, formatUsdValue } from "~/utils/numberFormats";
import { Doc } from "../../../convex/_generated/dataModel";
import { Address, getMarketFromMints, toAddress, tokensMetadata } from "../../../convex/utils/solana";
import { MnMSuspense } from "../MnMSuspense";
import { PoolTokenIcons } from "../TokenIcon";
import { LabelValue } from "../ui/labelValueRow";
import { Row } from "../ui/Row";
import { TableCell, TableRow } from "../ui/Table";
import { useToken, useTokenPrice } from "~/states/tokens";
import { Skeleton } from "../ui/Skeleton";
import { BinIdAndPrice, PositionTokenAmount } from "../../../convex/schema/positions";
import { FormattedBinPrice } from "../FormattedBinPrice";
import { Ellipsis, TriangleAlert, XCircle } from "lucide-react";
import { rawAmountToAmount } from "../../../convex/utils/amounts";
import { useDlmmOnChainPosition } from "~/states/positions";
import { api } from "../../../convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { startTrackingAction } from "../ActionTracker";
import { useMutation as useTanstackMut } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { LimitOrderValues } from "../LimitOrdersModal";
import { useConvexUser } from "~/providers/UserStates";
import { LimitOrderInput as LimitOrderInputType } from "../../../convex/schema/limitOrders";

export function DlmmOpenPositionRow({ dbPosition }: { dbPosition: Doc<"positions"> }) {
  const { convexUser } = useConvexUser();
  const poolAddress = toAddress(dbPosition.poolAddress);
  const positionPubkey = toAddress(dbPosition.positionPubkey);

  const orders =
    useQuery(api.tables.orders.get.getOrdersByPosition, {
      positionPubkey,
    }) ?? [];

  const createOrder = useMutation(api.tables.orders.mutations.createOrder);
  const updateOrder = useMutation(api.tables.orders.mutations.updateOrder);
  const cancel = useMutation(api.tables.orders.mutations.cancelOrder);

  const sl = orders.find((o) => o.direction === "sl");
  const tp = orders.find((o) => o.direction === "tp");

  const isSlActivated = sl?.status === "executing" || sl?.status === "executed" || sl?.status === "triggered";
  const isTpActivated = tp?.status === "executing" || tp?.status === "executed" || tp?.status === "triggered";

  return (
    <TableRow>
      {/*Pool */}
      <TableCell>
        <MnMSuspense fallback={<PoolSkeleton />}>
          <Pool poolAddress={poolAddress} leverage={dbPosition?.leverage ?? 1} />
        </MnMSuspense>
      </TableCell>
      {/*Size */}

      <TableCell>
        <MnMSuspense fallback={<Skeleton className="h-4 w-20" />}>
          <Size poolAddress={poolAddress} positionPubkey={positionPubkey} />
        </MnMSuspense>
      </TableCell>
      {/*range */}
      <TableCell>
        <MnMSuspense fallback={<Skeleton className="h-4 w-20" />}>
          <Range
            poolAddress={poolAddress}
            lowerBin={dbPosition.details.lowerBin}
            upperBin={dbPosition.details.upperBin}
          />
        </MnMSuspense>
      </TableCell>

      {/*Price/entry */}
      <TableCell>
        <MnMSuspense fallback={<Skeleton className="h-4 w-20" />}>
          <PoolPrice poolAddress={poolAddress} poolEntryPrice={dbPosition.poolEntryPrice} />
        </MnMSuspense>
      </TableCell>

      {/*Liquidation */}
      <TableCell>
        <MnMSuspense fallback={<Skeleton className="h-4 w-20" />}>
          <Liquidation />
        </MnMSuspense>
      </TableCell>

      {/*SL/TP , query open orders by position pubkey,use our modular componenet */}
      <TableCell>
        <MnMSuspense fallback={<Skeleton className="h-4 w-20" />}>
          <LimitOrderValues
            poolAddress={poolAddress}
            sl={sl ? { price: sl.triggerPrice, swapTo: sl.swapTo } : undefined}
            tp={tp ? { price: tp.triggerPrice, swapTo: tp.swapTo } : undefined}
            onSaveOrders={async (newSl, newTp) => {
              // --- Helper to compare order deep equality ---
              const isSame = (oldOrder?: LimitOrderInputType, newOrder?: LimitOrderInputType) => {
                if (!oldOrder && !newOrder) return true;
                if (!oldOrder || !newOrder) return false;
                return oldOrder.price === newOrder.price && oldOrder.swapTo === newOrder.swapTo;
              };

              // --------------------------
              //   NORMALIZED INPUTS
              // --------------------------
              const slInput = newSl?.price ? newSl : ({ price: 0, swapTo: "none" } as LimitOrderInputType);
              const tpInput = newTp?.price ? newTp : ({ price: 0, swapTo: "none" } as LimitOrderInputType);

              // --------------------------
              //   HANDLE STOP LOSS (SL)
              // --------------------------
              if (!sl && slInput.price === 0) {
                // Case: No SL before, no SL now → NOOP
              } else if (!sl && slInput.price > 0) {
                // Case: No SL before, user added one → CREATE
                await createOrder({
                  direction: "sl",
                  market: getMarketFromMints(dbPosition.tokenX.mint, dbPosition.tokenY.mint),
                  orderInput: slInput,
                  percentageToWithdraw: 100,
                  positionPubkey: dbPosition.positionPubkey,
                  userId: convexUser!._id,
                });
              } else if (sl && slInput.price === 0) {
                // Case: SL existed & now cleared → CANCEL
                await cancel({ orderId: sl._id, reason: "User canceled SL from UI" });
              } else if (sl && slInput.price > 0 && !isSame({ price: sl.triggerPrice, swapTo: sl.swapTo }, slInput)) {
                // Case: SL existed & changed → UPDATE
                await updateOrder({ orderId: sl._id, orderInput: slInput });
              }
              // else: SL existed & new value identical → NOOP

              // --------------------------
              //   HANDLE TAKE PROFIT (TP)
              // --------------------------
              if (!tp && tpInput.price === 0) {
                // Case: No TP before, no TP now → NOOP
              } else if (!tp && tpInput.price > 0) {
                // Case: No TP before, user added one → CREATE
                await createOrder({
                  direction: "tp",
                  market: getMarketFromMints(dbPosition.tokenX.mint, dbPosition.tokenY.mint),
                  orderInput: tpInput,
                  percentageToWithdraw: 100,
                  positionPubkey: dbPosition.positionPubkey,
                  userId: convexUser!._id,
                });
              } else if (tp && tpInput.price === 0) {
                // Case: TP existed & now cleared → CANCEL
                await cancel({ orderId: tp._id, reason: "User canceled TP from UI" });
              } else if (tp && tpInput.price > 0 && !isSame({ price: tp.triggerPrice, swapTo: tp.swapTo }, tpInput)) {
                // Case: TP existed & changed → UPDATE
                await updateOrder({ orderId: tp._id, orderInput: tpInput });
              }
              // else: TP existed & new value identical → NOOP
            }}
          />
        </MnMSuspense>
      </TableCell>

      {/*PNL*/}
      <TableCell>
        <MnMSuspense fallback={<Skeleton className="h-4 w-20" />}>
          <PnL
            poolAddress={poolAddress}
            positionPubkey={positionPubkey}
            xDb={dbPosition.tokenX}
            yDb={dbPosition.tokenY}
          />
        </MnMSuspense>
      </TableCell>
      <TableCell className="w-0 whitespace-nowrap pl-2">
        <Row justify="end" className="gap-2">
          <ViewMoreButton positionPubkey={positionPubkey} loanAddress={dbPosition.loanAddress} />
          <ClosePositionButton positionPubkey={positionPubkey} disable={isSlActivated || isTpActivated} />
        </Row>
      </TableCell>
    </TableRow>
  );
}

function ClosePositionButton({ positionPubkey, disable }: { positionPubkey: Address; disable: boolean }) {
  const closePosition = useAction(api.actions.dlmmPosition.removeLiquidity.removeLiquidity);

  const closePositionMut = useTanstackMut({
    mutationFn: async () => {
      const closePositionPromise = closePosition({
        percentageToWithdraw: 100,
        trigger: "manual",
        positionPubkey,
      });

      startTrackingAction({
        type: "close_position",
        action: closePositionPromise,
        onSuccess: async () => {},
      });
    },
  });

  return (
    <Button
      variant="danger"
      className="px-2 py-1.5 text-xs"
      onClick={closePositionMut.mutate}
      loading={closePositionMut.isPending}
      disabled={disable}
    >
      <XCircle className="w-4 h-4 text-red" />
      Close
    </Button>
  );
}

function ViewMoreButton({ positionPubkey, loanAddress }: { positionPubkey: Address; loanAddress?: string }) {
  const claimFees = useAction(api.actions.dlmmPosition.claimFees.claimFees);
  const leverageClaimFees = useAction(api.actions.dlmmPosition.tempClaimFees.claimFees);

  const claimFeesMut = useTanstackMut({
    mutationFn: async () => {
      console.log("Claimming fees");

      const claimFeesPromise = loanAddress
        ? leverageClaimFees({
            isAutomated: false,
            positionPubkey,
          })
        : claimFees({
            isAutomated: false,
            positionPubkey,
          });

      startTrackingAction({
        type: "claim_fees",
        action: claimFeesPromise,
        onSuccess: async () => {
          //refetch dllmm position here
        },
      });
    },
  });
  return (
    <Button
      variant="neutral"
      className="px-2 py-1.5 border border-white/20 text-xs"
      onClick={() => {
        console.log("s");
        claimFeesMut.mutate();
      }}
      loading={claimFeesMut.isPending}
    >
      <Ellipsis className="w-2.5 h-2.5" />
      View More
    </Button>
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
          <div className="text-text text-sm font-normal">{pool.name}</div>
          <div
            className={cn(
              "flex px-2 py-px rounded-full text-xs font-normal ",
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
            className="text-xs font-normal"
            valueClassName="text-xs font-normal"
            labelClassName="text-xs font-normal"
          />
          <LabelValue
            label={"B. Fee"}
            value={`${abbreviateAmount(pool.base_fee_percentage, { type: "percentage" })}%`}
            valueClassName="text-xs font-normal"
            labelClassName="text-xs font-normal"
          />
        </Row>
      </div>
    </Row>
  );
}

function Size({ poolAddress, positionPubkey }: { poolAddress: Address; positionPubkey: Address }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  const xPrice = useTokenPrice({ mint: pool.mint_x });
  const yPrice = useTokenPrice({ mint: pool.mint_y });

  const onChainPosition = useDlmmOnChainPosition({
    poolAddress,
    positionPubkey,
  });

  if (!onChainPosition) return <Skeleton className="w-20 h-3.5" />;
  const { totalXAmount, totalYAmount } = onChainPosition;

  // Current
  const currentX = rawAmountToAmount(Number(totalXAmount), tokenX.decimals);
  const currentY = rawAmountToAmount(Number(totalYAmount), tokenY.decimals);

  const usdX = currentX * xPrice;
  const usdY = currentY * yPrice;

  const totalUsd = usdX + usdY;

  return <div className="text-text text-xs font-normal">{formatUsdValue(totalUsd)}</div>;
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
    <Row justify="start" className="gap-1">
      {isInRange ? (
        <div className={"w-1.5 h-1.5 bg-green rounded-full"} />
      ) : (
        <TriangleAlert className="w-3 h-3 text-yellow" />
      )}
      <FormattedBinPrice value={lowerBin.price} classname="text-sm text-text font-normal" significantDigits={4} />
      <div className="text-sm text-text font-normal mx-px">-</div>
      <FormattedBinPrice value={upperBin.price} classname="text-sm text-text font-normal" significantDigits={4} />
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
            className="text-xs font-normal"
            valueClassName="text-xs font-normal"
            labelClassName="text-xs font-normal"
            isLoading
          />
          <LabelValue
            label={"B. Fee"}
            value={0}
            className="text-xs font-normal"
            valueClassName="text-xs font-normal"
            labelClassName="text-xs font-normal"
            isLoading
          />
        </Row>
      </div>
    </Row>
  );
}

function PoolPrice({ poolAddress, poolEntryPrice }: { poolAddress: Address; poolEntryPrice: number }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const currentPrice = Number(pool.current_price);
  return (
    <Row justify="start" className="gap-px">
      <FormattedBinPrice value={currentPrice} classname="text-sm text-text font-normal" significantDigits={4} />
      <div className="text-sm text-textSecondary font-normal">/</div>
      <FormattedBinPrice
        value={poolEntryPrice}
        classname="text-sm text-textSecondary font-normal"
        significantDigits={4}
      />
    </Row>
  );
}

function Liquidation() {
  const upperLiqPriceUp = 0;
  const lowerLiqPrice = 0;

  return (
    <Row justify="start" className="gap-px">
      {lowerLiqPrice === 0 ? (
        <div className="text-sm text-textSecondary font-normal">--</div>
      ) : (
        <FormattedBinPrice value={lowerLiqPrice} classname="text-sm text-yellow font-normal" significantDigits={4} />
      )}
      <div className="text-sm text-text font-normal">/</div>
      {upperLiqPriceUp === 0 ? (
        <div className="text-sm text-textSecondary font-normal">--</div>
      ) : (
        <FormattedBinPrice value={upperLiqPriceUp} classname="text-sm text-yellow font-normal" significantDigits={4} />
      )}
    </Row>
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

  const claimedFeesActivities = useQuery(api.tables.activities.get.getClaimedFeesByPosition, { positionPubkey });
  if (!onChainPosition)
    return (
      <div className="flex flex-col space-y-px">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-10" />
      </div>
    ); // should return placeholder or skeleton here as this will happen when we loading the on chain position
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
  // -----------------------------=
  const realizedFeesUsd =
    claimedFeesActivities?.reduce((acc, act) => {
      if (act.type !== "claim_fees") return acc;
      const { rawAmount, mint, usdPrice } = act.details.harvested;
      const decimals = tokensMetadata[mint]?.decimals;
      if (decimals == null) return acc;
      return acc + rawAmountToAmount(rawAmount, decimals) * usdPrice;
    }, 0) ?? 0;
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
        <div className={cn("text-sm font-normal", isProfit ? "text-green" : "text-red")}>
          {formatUsdValue(pnlUsd, { maximumFractionDigits: 5 })}
        </div>

        {/* PnL percentage */}
        <div
          className={cn(
            "flex px-2 py-px rounded-full text-xs font-normal",
            isProfit ? "text-green bg-green/10" : "text-red bg-red/10"
          )}
        >
          {abbreviateAmount(pnlPct, { type: "percentage" })}%
        </div>
      </Row>

      {/* Fees */}
      <div className="text-textSecondary text-xs font-normal">
        {formatUsdValue(unrealizedFeesUsd + realizedFeesUsd, { maximumFractionDigits: 5 })} in fees
      </div>
    </div>
  );
}
