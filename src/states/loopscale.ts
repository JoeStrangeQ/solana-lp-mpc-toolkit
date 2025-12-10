import { useSuspenseQuery } from "@tanstack/react-query";
import { Address } from "../../convex/utils/solana";
import { useCollateralToTokenAmount, useToken } from "./tokens";
import { usePool } from "./pools";
import { MS_1M, MS_1S } from "../../convex/utils/timeframe";
import { getLoopscaleMaxQuote, getLoopscaleOraclePrices } from "~/services/loopscale";
import { amountToRawAmount } from "../../convex/utils/amounts";

export function useLoopscaleQuote({
  userAddress,
  collateralMint,
  poolAddress,
  collateralUiAmount,
  tokenXSplit,
}: {
  userAddress: Address;
  collateralMint: Address;
  poolAddress: Address;
  collateralUiAmount: number;
  tokenXSplit: number;
}) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const collateralToken = useToken({ mint: collateralMint });
  const { tokenAmount: xAmount } = useCollateralToTokenAmount({
    collateralMint,
    collateralAmount: collateralUiAmount,
    mint: pool.mint_x,
    split: tokenXSplit,
  });
  const { tokenAmount: yAmount } = useCollateralToTokenAmount({
    collateralMint,
    collateralAmount: collateralUiAmount,
    mint: pool.mint_y,
    split: 1 - tokenXSplit,
  });

  const { data } = useSuspenseQuery({
    queryKey: ["loopscale-quote", poolAddress, collateralMint, collateralUiAmount],
    queryFn: async () => {
      const oraclePrices = await getLoopscaleOraclePrices();
      const xOracle = oraclePrices[pool.mint_x];
      const yOracle = oraclePrices[pool.mint_y];
      if (!xOracle || !yOracle) {
        throw new Error("Missing oracle prices for tokens");
      }

      const priceOverride = xAmount * xOracle.twapPrice + yAmount * yOracle.twapPrice;
      const quotes = await getLoopscaleMaxQuote({
        userAddress,
        collateralMint,
        poolAddress,
        priceOverride: priceOverride * 0.995, //add slippage
      });

      const best = quotes.reduce((a, b) => (a.ltv > b.ltv ? a : b));

      const maxLeverage = best.amount / amountToRawAmount(collateralUiAmount, collateralToken.decimals);
      return {
        maxLeverage: Math.max(1, maxLeverage),
        collateralIdentifier: best.collateralIdentifier,
        strategyAddress: best.strategy,
        apyPercent: best.apy / 10000,
        lqtCBps: best.lqt,
        apyCBps: best.apy,
      };
    },
    refetchInterval: MS_1S * 30,
    staleTime: MS_1M,
  });

  return data;
}
