import { MeteoraDlmmPool } from "~/services/dlmm";
import { useMeteoraPoolsSearch } from "~/states/dlmm";
import { Row } from "./ui/Row";
import { PoolTokenIcons } from "./TokenIcon";
import { useToken } from "~/states/tokens";
import { LabelValue } from "./ui/labelValueRow";
import { abbreviateAmount } from "~/utils/numberFormats";
import { Skeleton } from "./ui/Skeleton";
import { MnMSuspense } from "./MnMSuspense";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";

export function AvailablePairPools({
  currentPool,
}: {
  currentPool: MeteoraDlmmPool;
}) {
  const navigate = useNavigate();
  const { data, isLoading } = useMeteoraPoolsSearch({
    searchTerm: currentPool.name,
    includeTokenMints: [currentPool.mint_x, currentPool.mint_y],
  });
  // flatten all pages into a single array
  const pairPools = data?.pages?.flatMap((page) => page.pairs) ?? [];

  if (isLoading) {
    return (
      <div key={"loader"} className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <DlmmPoolRowSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (!isLoading && pairPools.length === 0) {
    return (
      <div key={"no-pools"} className="text-textSecondary text-sm">
        Couldn't find other {currentPool.name} pools
      </div>
    );
  }

  return (
    <div key={"pools"} className="relative flex flex-col gap-1 overflow-auto ">
      {pairPools.map((pool) => {
        if (pool.address === currentPool.address) return null;
        return (
          <MnMSuspense fallback={<DlmmPoolRowSkeleton />}>
            <motion.div
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.3 }}
            >
              <DlmmPoolRow
                key={pool.address}
                pool={pool}
                onClick={() => {
                  navigate({ to: `/dlmm/${pool.address}` });
                }}
              />
            </motion.div>
          </MnMSuspense>
        );
      })}
    </div>
  );
}

export function DlmmPoolRow({
  pool,
  onClick,
}: {
  pool: MeteoraDlmmPool;
  onClick: () => void;
}) {
  const tokenX = useToken({ mint: pool.mint_x });
  const tokenY = useToken({ mint: pool.mint_y });

  return (
    <Row
      className="items-center p-2 rounded-lg hover:bg-white/3 select-none cursor-pointer"
      onClick={onClick}
    >
      <PoolTokenIcons
        xIcon={tokenX.icon}
        yIcon={tokenY.icon}
        size={28}
        dex="Meteora"
      />
      <div className="flex flex-col -space-y-0.5 ml-2">
        <div className="text-text text-xs">{pool.name}</div>
        <LabelValue
          label={"Bin Step"}
          value={pool.bin_step}
          valueClassName="text-xs"
          labelClassName="text-xs"
        />
      </div>

      <div className="flex px-2 py-1 bg-backgroundQuaternary rounded-full ml-1.5 text-text text-[10px]">
        {abbreviateAmount(pool.base_fee_percentage, { type: "percentage" })}%
      </div>

      <div className="flex-1 min-w-28" />

      <div className="flex flex-row justify-end items-center gap-4">
        <LabelValue
          label="TVL"
          value={`$${abbreviateAmount(pool.liquidity, { type: "usd" })}`}
          labelClassName="text-xs"
          valueClassName="text-xs"
          className="text-right"
        />
        <LabelValue
          label="Fees 24h"
          value={`$${abbreviateAmount(pool.fees_24h, { type: "usd" })}`}
          labelClassName="text-xs"
          valueClassName="text-xs text-green"
          className="text-right"
        />
      </div>
    </Row>
  );
}

function DlmmPoolRowSkeleton() {
  return (
    <Row justify="start">
      <PoolTokenIcons isLoading size={28} />
      <div className="flex flex-col space-y-0.5 ml-2">
        <Skeleton className="w-16 h-4" />
        <LabelValue
          label={"Bin Step"}
          value={0}
          valueClassName="text-xs  w-8 h-3"
          labelClassName="text-xs"
          isLoading
        />
      </div>

      <Skeleton className="w-12 h-5 rounded-full ml-2" />

      <div className="flex flex-row items-center gap-2.5 ml-28">
        <LabelValue
          isLoading
          label={"TVL"}
          value={""}
          valueClassName="text-xs  h-3"
          labelClassName="text-xs"
        />
        <LabelValue
          isLoading
          label={"Fees 24h"}
          value={``}
          valueClassName="text-xs text-green h-3"
          labelClassName="text-xs"
        />
      </div>
    </Row>
  );
}
