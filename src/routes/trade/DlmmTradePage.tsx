import { PoolDataHeader } from "~/components/PoolDataHeader";
import { toAddress } from "../../../convex/utils/solana";
import { useParams } from "@tanstack/react-router";

export default function DlmmTradePage() {
  const { poolAddress } = useParams({ strict: false }) as {
    poolAddress: string;
  };

  return (
    <div className="w-full px-8 py-16">
      <PoolDataHeader protocol="dlmm" poolAddress={toAddress(poolAddress)} />
    </div>
  );
}
