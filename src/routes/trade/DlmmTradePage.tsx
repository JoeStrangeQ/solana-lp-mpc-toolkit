import { PoolDataHeader } from "~/components/PoolDataHeader";
import { toAddress } from "../../../convex/utils/solana";
import { useParams } from "@tanstack/react-router";
import { CreatePositionPanel } from "~/components/trade/CreatePositionPanel";
import { RangeSelectorPanel } from "~/components/trade/RangeSelectorPanel";

export default function DlmmTradePage() {
  const { poolAddress } = useParams({ strict: false }) as {
    poolAddress: string;
  };

  const parsedPoolAddress = toAddress(poolAddress);
  return (
    <div className="w-full px-8 py-16">
      <PoolDataHeader protocol="dlmm" poolAddress={toAddress(poolAddress)} />

      <div
        className="w-full grid gap-2
  xl:grid-cols-[1fr_0.66fr]
  lg:grid-cols-[1fr_0.75fr]
  md:grid-cols-1"
      >
        {/* LEFT SIDE (60%) */}
        <div className="flex flex-col gap-2 lg:grid lg:grid-rows-[7fr_3fr]">
          <div className="rounded-2xl bg-backgroundSecondary p-4">{/* Panel 1 — charts, LP overview, etc. */}s</div>

          <div className="rounded-2xl bg-backgroundSecondary px-4 py-3.5  overflow-hidden">
            <RangeSelectorPanel poolAddress={parsedPoolAddress} />
          </div>
        </div>

        {/* Create Position panel*/}
        <div className="rounded-2xl bg-backgroundSecondary px-4 py-6">
          <CreatePositionPanel poolAddress={parsedPoolAddress} />
        </div>
      </div>

      {/* 
      <div className="flex flex-row gap-2">
        <div className="flex flex-col bg-backgroundSecondary rounded-2xl w-[40%] px-5 py-5">
          <CollateralDepositInput />
        </div>
        <div className="flex flex-1 flex-col bg-red rounded-2xl w-[60%] h-full">s</div>
      </div> */}
    </div>
  );
}
