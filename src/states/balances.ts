import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { MS_1M } from "../../convex/utils/timeframe";
import { Address, zAddress } from "../../convex/utils/solana";
import { useToken } from "./tokens";

export function useBalances({ address }: { address: Address }) {
  const fetchBalance = useAction(api.actions.fetch.walletBalances.getWalletBalances);

  return useSuspenseQuery({
    queryKey: ["tokenBalances", address],
    queryFn: async () => fetchBalance({ address }),
    refetchInterval: MS_1M * 2,
    refetchIntervalInBackground: true,
  });
}

export function useTokenBalance({ address, mint }: { address: string; mint: Address }) {
  const { data } = useBalances({ address: zAddress.parse(address) });
  const tokenMetadata = useToken({ mint });

  const tokenBalance = data?.find((token) => token.mint === mint);

  if (!tokenBalance) {
    return {
      balance: 0,
      decimals: tokenMetadata.decimals,
      icon: tokenMetadata.icon,
      mint,
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      usdBalance: 0,
      usdPrice: 0,
      priceChange: 0,
      tokenAccount: null,
      tokenProgram: null,
    };
  }
  return tokenBalance;
}

export function useTotalUsdBalance({ address }: { address: string }) {
  const { data } = useBalances({ address: zAddress.parse(address) });

  const totalUsd = useMemo(() => {
    return data.reduce((sum, token) => sum + token.usdBalance, 0);
  }, [data]);

  return totalUsd;
}
