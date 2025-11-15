import DLMM from "@meteora-ag/dlmm";
import { connection } from "../convexEnv";
import { PublicKey } from "@solana/web3.js";
import { serializeBinLiquidity } from "../utils/meteora";

export interface SerializedBinLiquidity {
  binId: number;
  xAmount: string;
  yAmount: string;
  supply: string;
  version: number;
  price: string;
  pricePerToken: string;
  feeAmountXPerTokenStored: string;
  feeAmountYPerTokenStored: string;
  rewardPerTokenStored: string[];
}

const poolCache: Record<string, DLMM> = {};
export async function getDlmmPoolConn(poolAddress: string) {
  if (!poolCache[poolAddress]) {
    poolCache[poolAddress] = await DLMM.create(connection, new PublicKey(poolAddress));
  }
  return poolCache[poolAddress];
}

export async function getBinsAroundActiveBin({
  poolAddress,
  numberOfBinsToTheLeft,
  numberOfBinsToTheRight,
}: {
  poolAddress: string;
  numberOfBinsToTheLeft: number;
  numberOfBinsToTheRight: number;
}) {
  const dlmmPoolConn = await getDlmmPoolConn(poolAddress);
  const result = await dlmmPoolConn.getBinsAroundActiveBin(numberOfBinsToTheLeft, numberOfBinsToTheRight);

  return {
    activeBin: result.activeBin,
    bins: result.bins.map(serializeBinLiquidity),
  };
}

export async function getActiveBin({ poolAddress }: { poolAddress: string }) {
  const dlmmPoolConn = await getDlmmPoolConn(poolAddress);
  const result = await dlmmPoolConn.getActiveBin();

  return serializeBinLiquidity(result);
}
