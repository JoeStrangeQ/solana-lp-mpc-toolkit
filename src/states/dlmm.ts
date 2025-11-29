import { useInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { MS_1M, MS_1S } from "../../convex/utils/timeframe";
import { getMeteoraPoolsWithPagination } from "~/services/dlmm";
import { Address } from "../../convex/utils/solana";

export function useBinsAroundActiveBin({
  poolAddress,
  numberOfBinsToTheLeft = 33,
  numberOfBinsToTheRight = 33,
}: {
  poolAddress: string;
  numberOfBinsToTheLeft?: number;
  numberOfBinsToTheRight?: number;
}) {
  const getBinsAroundActiveBin = useAction(api.actions.fetch.dlmm.getBinsAroundActiveBinAction);

  const { data } = useSuspenseQuery({
    queryKey: [`poolActiveBinRange-${poolAddress}-${numberOfBinsToTheLeft}`],
    queryFn: async () => {
      const binsAroundActiveBin = await getBinsAroundActiveBin({
        poolAddress,
        numberOfBinsToTheLeft,
        numberOfBinsToTheRight,
      });

      const activeIndex = binsAroundActiveBin.bins.findIndex((b) => b.binId === binsAroundActiveBin.activeBin);
      // 69 bins with current price bin centered
      const initialBins = binsAroundActiveBin.bins.slice(Math.max(0, activeIndex - 35), activeIndex + 35);

      return { binRange: binsAroundActiveBin, initialBins };
    },
    refetchInterval: 5_700,
  });

  return data;
}

export function useMeteoraPoolsSearch({
  searchTerm,
  includeTokenMints,
}: {
  searchTerm?: string;
  includeTokenMints?: Address[];
}) {
  return useInfiniteQuery({
    queryKey: ["pools/search", searchTerm],
    queryFn: async ({ pageParam = 0 }) =>
      await getMeteoraPoolsWithPagination({
        page: pageParam,
        search: searchTerm,
        includeTokenMints,
        limit: 30,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const total = lastPage?.total ?? 0;
      const fetched = allPages.flatMap((page) => page.pairs).length;
      return fetched < total ? allPages.length : undefined;
    },
    refetchInterval: MS_1S * 30,
    staleTime: MS_1M,
  });
}
