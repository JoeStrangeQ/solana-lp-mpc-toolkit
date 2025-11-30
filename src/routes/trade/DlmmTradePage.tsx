import { PoolDataHeader } from "~/components/PoolDataHeader";
import { Address, toAddress } from "../../../convex/utils/solana";
import { useParams } from "@tanstack/react-router";
import { CreatePositionPanel, CreatePositionPanelSkeleton } from "~/components/trade/CreatePositionPanel";
import { RangeSelectorPanel, RangeSelectorPanelSkeleton } from "~/components/trade/RangeSelectorPanel";
import { MnMSuspense } from "~/components/MnMSuspense";
import { ChartColumnIncreasing } from "lucide-react";
import { usePool } from "~/states/pools";

export default function DlmmTradePage() {
  const { poolAddress } = useParams({ strict: false }) as {
    poolAddress: string;
  };

  const parsedPoolAddress = toAddress(poolAddress);

  return (
    <div className="w-full px-8 py-11">
      <PoolDataHeader classname="mb-3.5" protocol="dlmm" poolAddress={parsedPoolAddress} />

      <div
        className="
          w-full grid gap-2
          xl:grid-cols-[1fr_0.62fr]
          md:grid-cols-1
        "
      >
        <div className="flex flex-col gap-2 order-2 xl:order-1">
          {/* Range ABOVE Chart everywhere except XL */}
          <div className="rounded-2xl bg-backgroundSecondary px-4 py-3.5 overflow-hidden order-1 xl:order-2">
            <MnMSuspense fallback={<RangeSelectorPanelSkeleton />}>
              <RangeSelectorPanel poolAddress={parsedPoolAddress} />
            </MnMSuspense>
          </div>

          <div className="rounded-2xl bg-backgroundSecondary order-2 xl:order-1 min-h-[380px]">
            <MnMSuspense
              fallback={
                <div className="w-full h-full flex flex-1 rounded-2xl items-center justify-center">
                  <ChartColumnIncreasing className="w-10 h-10 animate-pulse text-text" />
                </div>
              }
            >
              <TradingViewChartTemp poolAddress={parsedPoolAddress} />
            </MnMSuspense>
          </div>
        </div>

        <div className="rounded-2xl bg-backgroundSecondary px-4 py-6 order-1 xl:order-2">
          <MnMSuspense fallback={<CreatePositionPanelSkeleton />}>
            <CreatePositionPanel poolAddress={parsedPoolAddress} />
          </MnMSuspense>
        </div>
      </div>
    </div>
  );
}

function TradingViewChartTemp({ poolAddress }: { poolAddress: Address }) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return (
    <iframe
      className="w-full h-full flex flex-1 rounded-2xl"
      src={`https://birdeye.so/tv-widget/${pool.mint_x}/${pool.mint_y}?chain=solana&viewMode=base%2Fquote&chartInterval=15&chartType=Candle&chartTimezone=${timeZone}&chartLeftToolbar=show&theme=dark&cssCustomProperties=--tv-color-platform-background%3A%230c0c12&cssCustomProperties=--tv-color-pane-background%3A%2311131a&chartOverrides=mainSeriesProperties.candleStyle.upColor%3A%2329cc88&chartOverrides=mainSeriesProperties.candleStyle.borderUpColor%3A%2329cc88&chartOverrides=mainSeriesProperties.candleStyle.wickUpColor%3A%2329cc88&chartOverrides=mainSeriesProperties.candleStyle.downColor%3A%23fd4a4a&chartOverrides=mainSeriesProperties.candleStyle.borderDownColor%3A%23fd4a4a&chartOverrides=mainSeriesProperties.candleStyle.wickDownColor%3A%23fd4a4a&chartOverrides=paneProperties.backgroundType%3Asolid&chartOverrides=paneProperties.background%3Argba%2812%2C+12%2C+18%2C+1%29`}
      allowFullScreen={true}
    />
  );
}
