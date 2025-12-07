import { useSuspenseQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { MS_1M } from "../../convex/utils/timeframe";
import { Address, mints, tokensMetadata } from "../../convex/utils/solana";

export function useToken({ mint, forceFetch = false }: { mint: Address; forceFetch?: boolean }) {
  const fetchTokenMetadata = useAction(api.actions.fetch.tokenMetadata.getTokenMetadataAction);

  const staticMetadata = tokensMetadata[mint];
  const shouldUseStatic = staticMetadata && !forceFetch;

  const { data: tokenMetadata } = useSuspenseQuery({
    queryKey: ["tokensMetadata", mint, forceFetch],
    queryFn: async () => {
      if (shouldUseStatic) return staticMetadata;
      return await fetchTokenMetadata({ mint });
    },
    refetchInterval: MS_1M * 1.1, // backend cache 1 min
  });

  return tokenMetadata;
}

export function useTokenPrice({ mint }: { mint: Address }): number {
  const getTokenPrices = useAction(api.actions.fetch.tokenPrices.getJupiterTokenPriceAction);
  // const { usdPrice } = useToken({ mint });

  const { data } = useSuspenseQuery({
    queryKey: ["tokenPrice", mint],
    queryFn: async () => {
      //TODO: Uncomment once decreasing the tokenMetadata cache ttl
      // if (usdPrice != null && !Number.isNaN(usdPrice)) {
      //   return usdPrice;
      // }

      return await getTokenPrices({ mint });
    },
    staleTime: MS_1M * 2,
    refetchInterval: MS_1M * 2,
  });

  return data;
}

export function useUsdToSolEquivalent(usdAmount: number): number {
  const solPrice = useTokenPrice({ mint: tokensMetadata[mints.sol].address });
  return usdAmount / solPrice;
}

export function useCollateralToTokenAmount({
  mint,
  collateralMint,
  collateralAmount,
  split,
}: {
  mint: Address;
  collateralMint: Address;
  collateralAmount: number;
  split: number;
}) {
  const tokenPrice = useTokenPrice({ mint });
  const depositTokenPrice = useTokenPrice({ mint: collateralMint });

  const collateralAmountUsd = collateralAmount * depositTokenPrice;
  const tokenUsdAmount = collateralAmountUsd * split;
  const tokenAmount = tokenUsdAmount / tokenPrice;

  return {
    collateralAmountUsd,
    tokenUsdAmount,
    tokenAmount,
  };
}
