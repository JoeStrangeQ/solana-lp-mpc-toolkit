import { BinLiquidity } from "@meteora-ag/dlmm";
import { SerializedBinLiquidity } from "../services/meteora";

export function serializeBinLiquidity(bin: BinLiquidity): SerializedBinLiquidity {
  return {
    ...bin,
    xAmount: bin.xAmount.toString(),
    yAmount: bin.yAmount.toString(),
    supply: bin.supply.toString(),
    feeAmountXPerTokenStored: bin.feeAmountXPerTokenStored.toString(),
    feeAmountYPerTokenStored: bin.feeAmountYPerTokenStored.toString(),
    rewardPerTokenStored: bin.rewardPerTokenStored.map((bn: any) => bn.toString()),
  };
}

// export function serializePositionData(
//   data: PositionData,
// ): SerializedPositionData {
//   return {
//     totalXAmount: data.totalXAmount,
//     totalYAmount: data.totalYAmount,
//     positionBinData: data.positionBinData, // already JSON-safe
//     lastUpdatedAt: data.lastUpdatedAt.toString(),
//     upperBinId: data.upperBinId,
//     lowerBinId: data.lowerBinId,
//     feeX: data.feeX.toString(),
//     feeY: data.feeY.toString(),
//     rewardOne: data.rewardOne.toString(),
//     rewardTwo: data.rewardTwo.toString(),
//     feeOwner: data.feeOwner.toBase58(),
//     totalClaimedFeeXAmount: data.totalClaimedFeeXAmount.toString(),
//     totalClaimedFeeYAmount: data.totalClaimedFeeYAmount.toString(),
//     feeXExcludeTransferFee: data.feeXExcludeTransferFee.toString(),
//     feeYExcludeTransferFee: data.feeYExcludeTransferFee.toString(),
//     rewardOneExcludeTransferFee: data.rewardOneExcludeTransferFee.toString(),
//     rewardTwoExcludeTransferFee: data.rewardTwoExcludeTransferFee.toString(),
//     totalXAmountExcludeTransferFee:
//       data.totalXAmountExcludeTransferFee.toString(),
//     totalYAmountExcludeTransferFee:
//       data.totalYAmountExcludeTransferFee.toString(),
//     owner: data.owner.toBase58(),
//   }
// }
