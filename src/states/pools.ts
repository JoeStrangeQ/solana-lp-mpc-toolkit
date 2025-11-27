import { Protocol } from "~/providers/useLastVisitedPool";
import { Address } from "../../convex/utils/solana";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getMeteoraDlmmPool } from "~/services/dlmm";
import { MS_1M, MS_1S } from "../../convex/utils/timeframe";

export function usePool({ poolAddress, protocol }: { poolAddress: Address; protocol: Protocol }) {
  const { data } = useSuspenseQuery({
    queryKey: [`protocol-${protocol}&pool-${poolAddress}`],
    queryFn: async () => {
      //in the future use protocol
      return getMeteoraDlmmPool({ poolAddress });
    },
    refetchInterval: MS_1S * 30,
    staleTime: MS_1M * 1,
  });

  return data;
}
