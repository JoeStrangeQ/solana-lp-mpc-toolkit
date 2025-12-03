import { useAction } from "convex/react";
import { Address } from "../../convex/utils/solana";
import { api } from "../../convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MS_1S } from "../../convex/utils/timeframe";
import { SerializedPositionData } from "../../convex/services/meteora";

export function useDlmmOnChainPosition({
  poolAddress,
  positionPubkey,
}: {
  poolAddress: Address;
  positionPubkey: Address;
}): SerializedPositionData | null {
  const getPosition = useAction(api.actions.fetch.dlmm.getOpenPosition);

  const { data } = useSuspenseQuery({
    queryKey: [`dlmmOnChainPosition-${positionPubkey}-${poolAddress}`],
    queryFn: async () => await getPosition({ poolAddress, positionPubkey }),
    refetchInterval: MS_1S * 2,
    staleTime: MS_1S * 30,
  });

  return data;
}

// export function useOpenPositions({userId}:{userId:Address}){

//     const getUserOpenPositions =()=>void// useAction()
//       return useQuery({
//     queryKey: ["openPositions", userId],
//     queryFn: async () => {
//       // 1. Get basic DB positions
//       const dbPositions = getUserOpenPositions()

//     //   if (dbPositions.length === 0) return [];

//       // 2. Enrich with on-chain
//       return convex.action("positions:enrichPositions", {
//         positions: dbPositions,
//       });

//       return false
//     },
//     refetchInterval: 15_000, // 15s to stay “live”
//   });
// }
