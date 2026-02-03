import { BinLiquidity, PositionData } from "@meteora-ag/dlmm";
import {
  SerializedBinLiquidity,
  SerializedPositionData,
} from "../services/meteora";
import { Address } from "./solana";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const METEORA_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

export function serializeBinLiquidity(
  bin: BinLiquidity,
): SerializedBinLiquidity {
  return {
    ...bin,
    xAmount: bin.xAmount.toString(),
    yAmount: bin.yAmount.toString(),
    supply: bin.supply.toString(),
    feeAmountXPerTokenStored: bin.feeAmountXPerTokenStored.toString(),
    feeAmountYPerTokenStored: bin.feeAmountYPerTokenStored.toString(),
    rewardPerTokenStored: bin.rewardPerTokenStored.map((bn: any) =>
      bn.toString(),
    ),
  };
}

export function serializePositionData(
  data: PositionData,
): SerializedPositionData {
  return {
    totalXAmount: data.totalXAmount,
    totalYAmount: data.totalYAmount,
    positionBinData: data.positionBinData, // already JSON-safe
    lastUpdatedAt: data.lastUpdatedAt.toString(),
    upperBinId: data.upperBinId,
    lowerBinId: data.lowerBinId,
    feeX: data.feeX.toString(),
    feeY: data.feeY.toString(),
    rewardOne: data.rewardOne.toString(),
    rewardTwo: data.rewardTwo.toString(),
    feeOwner: data.feeOwner.toBase58(),
    totalClaimedFeeXAmount: data.totalClaimedFeeXAmount.toString(),
    totalClaimedFeeYAmount: data.totalClaimedFeeYAmount.toString(),
    feeXExcludeTransferFee: data.feeXExcludeTransferFee.toString(),
    feeYExcludeTransferFee: data.feeYExcludeTransferFee.toString(),
    rewardOneExcludeTransferFee: data.rewardOneExcludeTransferFee.toString(),
    rewardTwoExcludeTransferFee: data.rewardTwoExcludeTransferFee.toString(),
    totalXAmountExcludeTransferFee:
      data.totalXAmountExcludeTransferFee.toString(),
    totalYAmountExcludeTransferFee:
      data.totalYAmountExcludeTransferFee.toString(),
    owner: data.owner.toBase58(),
  };
}

function derivePositionPubkey(
  lbPair: PublicKey,
  base: PublicKey,
  lowerBinId: BN,
  width: BN,
  programId: PublicKey,
) {
  let lowerBinIdBytes: Uint8Array;
  if (lowerBinId.isNeg()) {
    lowerBinIdBytes = new Uint8Array(
      lowerBinId.toTwos(32).toArrayLike(Buffer, "le", 4),
    );
  } else {
    lowerBinIdBytes = new Uint8Array(lowerBinId.toArrayLike(Buffer, "le", 4));
  }
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      lbPair.toBuffer(),
      base.toBuffer(),
      lowerBinIdBytes,
      new Uint8Array(width.toArrayLike(Buffer, "le", 4)),
    ],
    programId,
  );
}

export function deriveMeteoraPositionPubkey({
  poolAddress,
  lowerBinId,
  upperBinId,
  loanPda,
}: {
  poolAddress: Address;
  lowerBinId: number;
  upperBinId: number;
  loanPda: PublicKey;
}) {
  const width = upperBinId - lowerBinId + 1;

  const lbPairPubkey = new PublicKey(poolAddress);

  const [pda, _] = derivePositionPubkey(
    lbPairPubkey,
    loanPda,
    new BN(lowerBinId),
    new BN(width),
    new PublicKey(METEORA_PROGRAM_ID),
  );

  return pda;
}
