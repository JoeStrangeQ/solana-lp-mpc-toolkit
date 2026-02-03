import { Protocol, useLastVisitedPool } from "~/providers/useLastVisitedPool";
import {
  Address,
  BaseTokenMetadata,
  mints,
  tokensMetadata,
} from "../../../convex/utils/solana";
import { PoolTokenIcons } from "../TokenIcon";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "~/utils/cn";
import { usePool } from "~/states/pools";
import { useEffect } from "react";
import { Skeleton } from "../ui/Skeleton";

export const DEFAULT_DLMM_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const pairs = [
  {
    tokenX: tokensMetadata[mints.sol],
    tokenY: tokensMetadata[mints.usdc],
    defaultDlmmPool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
  },
  {
    tokenX: tokensMetadata[mints.met],
    tokenY: tokensMetadata[mints.usdc],
    defaultDlmmPool: "5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd",
  },
  {
    tokenX: tokensMetadata[mints.met],
    tokenY: tokensMetadata[mints.sol],
    defaultDlmmPool: "AsSyvUnbfaZJPRrNh3kUuvZTeHKoMVWEoHz86f4Q5D9x",
  },
];

export function getPairKey(x: BaseTokenMetadata, y: BaseTokenMetadata) {
  return `${x.symbol}-${y.symbol}`;
}

export function PairSelector({
  currentPoolAddress,
  protocol,
}: {
  currentPoolAddress: Address;
  protocol: Protocol;
}) {
  const navigate = useNavigate();

  const pool = usePool({ poolAddress: currentPoolAddress, protocol });
  const { setLastByPairKey, getLastByPairKey } = useLastVisitedPool();

  useEffect(() => {
    setLastByPairKey({
      pairKey: pool.name.toLowerCase(),
      poolAddress: pool.address,
      protocol,
    });
  }, [pool.address, protocol]);
  return (
    <div className="flex flex-row items-center bg-backgroundSecondary rounded-full p-1">
      {pairs.map(({ tokenX, tokenY, defaultDlmmPool }) => {
        const key = getPairKey(tokenX, tokenY);
        const isSelected = key.toLowerCase() === pool.name.toLowerCase();

        return (
          <div
            key={key}
            onClick={() => {
              const last = getLastByPairKey(key);
              navigate({
                to: `/${last?.protocol ?? "dlmm"}/${last?.poolAddress ?? defaultDlmmPool}`,
              });
            }}
            className={cn(
              "flex items-center gap-1 px-3 py-1 rounded-full cursor-pointer transition text-sm",
              isSelected
                ? "bg-white/5 text-text"
                : "text-textSecondary hover:brightness-110",
            )}
          >
            <PoolTokenIcons xIcon={tokenX.icon} yIcon={tokenY.icon} size={18} />
            {key}
          </div>
        );
      })}
    </div>
  );
}

export function PairSelectorSkeleton() {
  return (
    <div className="flex flex-row items-center bg-backgroundSecondary rounded-full p-2">
      {pairs.map((p) => {
        return (
          <div
            key={`${p.tokenX}-${p.tokenY}`}
            className={cn(
              "flex items-center gap-1 px-3 py-1 rounded-full cursor-pointer transition",
              "text-textSecondary hover:brightness-110",
            )}
          >
            <PoolTokenIcons isLoading size={18} />
            <Skeleton className="w-[70PX] h-4" />
          </div>
        );
      })}
    </div>
  );
}
