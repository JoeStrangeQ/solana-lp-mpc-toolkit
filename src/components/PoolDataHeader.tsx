import { Address } from "../../convex/utils/solana";
import { useToken } from "~/states/tokens";
import { PoolTokenIcons } from "./TokenIcon";
import { LabelValue } from "./ui/labelValueRow";
import { abbreviateAmount } from "~/utils/numberFormats";
import { ChevronDown } from "lucide-react";
import { FormattedBinPrice } from "./FormattedBinPrice";
import { Protocol } from "~/providers/useLastVisitedPool";
import { usePool } from "~/states/pools";
import { Skeleton } from "./ui/Skeleton";
import { MnMSuspense } from "./MnMSuspense";
import { Dropdown } from "./ui/Dropdown";
import { AvailablePairPools } from "./AvaliablePairPools";
import { cn } from "~/utils/cn";

export function PoolDataHeader({
  poolAddress,
  protocol,
  classname,
}: {
  poolAddress: Address;
  protocol: Protocol;
  classname?: string;
}) {
  return (
    <div className={cn("flex flex-col w-full items-start h-min", classname)}>
      {protocol === "dlmm" ? (
        <MnMSuspense fallback={<DlmmHeaderSkeleton />}>
          <DlmmHeader poolAddress={poolAddress} />
        </MnMSuspense>
      ) : (
        <></>
      )}
    </div>
  );
}

export function DlmmHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-0 lg:flex-row lg:items-center lg:justify-between w-full">
      <div className="flex flex-row items-center">
        <PoolTokenIcons isLoading size={44} dex="Meteora" />
        <div className="flex flex-col ml-3 space-y-0.5">
          <Skeleton className="h-6 w-40 rounded-md" />
          <div className="flex flex-row items-center gap-2">
            <LabelValue label={"Bin Step"} value={""} isLoading />
            <LabelValue label={"Base Fee"} value={""} isLoading />
          </div>
        </div>

        <Skeleton className="ml-5 rounded-lg" style={{ width: 28, height: 28 }} />
      </div>

      <div className="flex flex-col lg:items-end gap-1">
        <div className="w-96 h-px bg-white/5 lg:hidden mb-2" />
        <div className="flex flex-row items-center gap-4">
          <LabelValue label={"Price"} value={""} isLoading />
          <LabelValue label={"TVL"} value={""} isLoading />
          <LabelValue label={"24h Vol"} value={""} isLoading />
          <LabelValue label={"24h Fees"} value={""} isLoading />
        </div>

        <div className="flex flex-row items-center gap-4">
          <LabelValue label={"Daily Borrow Rate"} value={0} isLoading />
          <LabelValue label={"Borrow Cap"} value={0} isLoading />
        </div>
      </div>
    </div>
  );
}
function DlmmHeader({ poolAddress }: { poolAddress: Address }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  return (
    <div className="flex flex-col gap-4 lg:gap-0 lg:flex-row lg:items-center lg:justify-between w-full">
      <div className="flex flex-row items-center">
        <PoolTokenIcons xIcon={tokenX.icon} size={44} yIcon={tokenY.icon} dex="Meteora" />
        <div className="flex flex-col ml-3 -space-y-1">
          <div className="text-text text-2xl">{pool.name}</div>
          <div className="flex flex-row items-center gap-2">
            <LabelValue label={"Bin Step"} value={pool.bin_step} />
            <LabelValue label={"Base Fee"} value={abbreviateAmount(pool.base_fee_percentage, { type: "percentage" })} />
          </div>
        </div>

        <Dropdown
          className="ml-5"
          align="left"
          trigger={
            <div className="bg-backgroundQuaternary p-1 rounded-lg hover:brightness-120 hover-effect cursor-pointer active:scale-95">
              <ChevronDown className="w-5 h-5 text-text" />
            </div>
          }
          dropdownClassName="px-1 py-1"
          content={<AvailablePairPools currentPool={pool} />}
        />
      </div>

      <div className="flex flex-col lg:items-end gap-1">
        <div className="w-96 h-px bg-white/5 lg:hidden mb-2" />
        <div className="flex flex-row items-center gap-4">
          <LabelValue
            label={"Price"}
            value={
              <div className="flex flex-row items-center gap-0.5">
                <FormattedBinPrice value={pool.current_price} significantDigits={4} />
              </div>
            }
          />
          <LabelValue label={"TVL"} value={`$${abbreviateAmount(pool.liquidity, { type: "usd" })}`} />
          <LabelValue label={"24h Vol"} value={`$${abbreviateAmount(pool.trade_volume_24h, { type: "usd" })}`} />
          <LabelValue
            label={"24h Fees"}
            value={`$${abbreviateAmount(pool.fees_24h, { type: "usd" })}`}
            valueClassName="text-green"
          />
        </div>

        <div className="flex flex-row items-center gap-4">
          <LabelValue label={"Daily Borrow Rate"} value={0} />
          <LabelValue label={"Borrow Cap"} value={0} />
        </div>
      </div>
    </div>
  );
}
