import { useSuspenseQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

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
      const initialBins = binsAroundActiveBin.bins.slice(Math.max(0, activeIndex - 34), activeIndex + 35);

      return { binRange: binsAroundActiveBin, initialBins };
    },
    refetchInterval: 5_700,
  });

  return data;
}
