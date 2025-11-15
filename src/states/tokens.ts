import { useSuspenseQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TOKENS_METADATA } from "~/utils/solana";
import { MS_1M } from "../../convex/utils/timeframe";
import { TokenMetadata } from "../../convex/services/jupiter";
import { Address } from "../../convex/utils/address";

export function useToken({ mint }: { mint: Address }): TokenMetadata {
  const fetchTokenMetadata = useAction(api.actions.fetch.tokenMetadata.getTokensMetadataAction);

  const { data: tokenMetadata } = useSuspenseQuery({
    queryKey: ["tokensMetadata", mint],
    queryFn: async () => {
      return await fetchTokenMetadata({ mints: [mint] });
    },
    refetchInterval: MS_1M * 1.1, // BACKEND CACHE FOR 1 MIN
  });

  return tokenMetadata[0];
}

export function useTokenPrice({ mint }: { mint: Address }): number {
  const getTokenPrices = useAction(api.actions.fetch.tokenPrices.getJupiterTokenPricesAction);
  const { usdPrice } = useToken({ mint });

  const { data } = useSuspenseQuery({
    queryKey: ["tokenPrice", mint],
    queryFn: async () => {
      if (usdPrice != null && !Number.isNaN(usdPrice)) {
        return usdPrice;
      }

      const fetchedPrice = await getTokenPrices({ mints: [mint] });
      const price = fetchedPrice?.[mint]?.usdPrice;
      if (!price) {
        console.warn("Missing price for mint:", mint);
        throw new Error(`Price unavailable for token ${mint}`);
      }

      return price;
    },
    staleTime: MS_1M * 2,
    refetchInterval: MS_1M * 2,
  });

  return data;
}

export function useUsdToSolEquivalent(usdAmount: number): number {
  const solPrice = useTokenPrice({ mint: TOKENS_METADATA.SOL.address });
  return usdAmount / solPrice;
}

export function useTokensMetadata({ mints }: { mints: string[] }) {
  const getTokenMetadata = useAction(api.actions.fetch.tokenMetadata.getTokensMetadataAction);
  const { data } = useSuspenseQuery({
    queryKey: ["portfolioTokensMetadata", mints],
    queryFn: async () => {
      if (mints.length === 0) return {};
      const metadataPromises = mints.map(async (mint) => {
        const metadata = await getTokenMetadata({ mints: [mint] });
        return { mint, metadata };
      });
      const results = await Promise.all(metadataPromises);
      return results.reduce(
        (acc, { mint, metadata }) => {
          acc[mint] = metadata;
          return acc;
        },
        {} as Record<string, any>
      );
    },
    staleTime: 5 * 60 * 1000,
  });
  return data;
}

export function useTokensPrices({ mints }: { mints: string[] }) {
  const getJupiterTokenPrices = useAction(api.actions.fetch.tokenPrices.getJupiterTokenPricesAction);
  const { data } = useSuspenseQuery({
    queryKey: ["portfolioTokenPrices", mints],
    queryFn: async () => {
      if (mints.length === 0) return {};
      return await getJupiterTokenPrices({ mints: mints });
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
  return data;
}
