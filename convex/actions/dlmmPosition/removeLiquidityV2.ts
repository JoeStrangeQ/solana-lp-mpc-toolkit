"use node";
import { v } from "convex/values";
import { vTriggerType } from "../../schema/activities";
import { action } from "../../_generated/server";
import { authenticateUser } from "../../privy";
import { api, internal } from "../../_generated/api";
import { getDlmmPoolConn } from "../../services/meteora";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import DLMM, { PositionData } from "@meteora-ag/dlmm";
import { Address, getCuInstructions, toAddress, tokensMetadata } from "../../utils/solana";
import { connection } from "../../convexEnv";
import { getRandomNozomiTipPubkey, sendNozomiTransaction } from "../../helpers/nozomi";
import { transferMnMFees } from "../../helpers/transferMnMFees";
import { rawAmountToAmount } from "../../utils/amounts";
import { Doc } from "../../_generated/dataModel";
import { getJupiterTokenPrices } from "../../services/jupiter";
import { executeSwapsWithNozomi, NozomiExecutedSwapQuote, SwapSpec } from "../../helpers/executeSwapsWithNozomi";
import { parseTransactionsBalanceChanges } from "../../helpers/parseTransaction";

//TODO: return failed and partiallyFailed so in limit orders we will know how to handle.
export const removeLiquidity = action({
  args: {
    trigger: vTriggerType,
    positionPubkey: v.string(),
    percentageToWithdraw: v.number(),
    fromBinId: v.optional(v.number()),
    toBinId: v.optional(v.number()),
    //TODO: add optional fee amounts and swap quotes (when preforming from the front-end)
  },
  handler: async (ctx, args) => {
    try {
      console.time("auth");
      const { user, userWallet } = await authenticateUser({ ctx });
      if (!user) throw new Error("Couldn't find user");
      const { positionPubkey, percentageToWithdraw, trigger } = args;
      console.timeEnd("auth");

      console.time("getDbPosition");
      const position = await ctx.runQuery(api.tables.positions.get.getPositionByPubkey, { positionPubkey });
      if (!position) throw new Error(`Position ${positionPubkey} not found`);
      console.timeEnd("getDbPosition");

      console.time("getOnChainPosition");
      const dlmmPoolConn = await getDlmmPoolConn(position.poolAddress);
      const { positionData: onChainPosition } = await dlmmPoolConn.getPosition(new PublicKey(positionPubkey));

      const userAddress = toAddress(userWallet.address);
      const xMint = toAddress(position.tokenX.mint);
      const yMint = toAddress(position.tokenY.mint);
      const outputMint = toAddress(position.collateral.mint);
      console.timeEnd("getOnChainPosition");

      console.time("blockash");
      const blockhash = await connection.getLatestBlockhash();
      console.timeEnd("blockash");

      console.time("buildRem");
      const { removeTx } = await buildRemoveLiquidityTx({
        userAddress,
        dlmmPoolConn,
        fromBinId: args.fromBinId ?? position.details.lowerBin.id,
        toBinId: args.toBinId ?? position.details.upperBin.id,
        percentageToWithdraw,
        positionPubkey,
        options: {
          useNozomi: true,
          recentBlockhash: blockhash.blockhash,
        },
      });
      console.timeEnd("buildRem");

      console.time("sendRem");
      const removeLiquidityTxId = await sendNozomiTransaction({ userWallet, versionedTx: removeTx });
      console.timeEnd("sendRem");

      console.time("remConfirm");
      const removeLiqRes = await parseTransactionsBalanceChanges({
        userAddress: userWallet.address,
        signatures: [removeLiquidityTxId],
        shouldAwaitConfirmation: true,
      });

      if (!removeLiqRes.ok) {
        return {
          status: "failed",
          errorMsg: "Remove liquidation failed",
        };
      }
      console.log("x removed", removeLiqRes.tokenBalancesChange[0].rawAmount.toString());
      console.log("y removed", removeLiqRes.tokenBalancesChange[1].rawAmount.toString());

      const xDelta = removeLiqRes.tokenBalancesChange[xMint]?.rawAmount ?? new BN(0);
      const yDelta = removeLiqRes.tokenBalancesChange[yMint]?.rawAmount ?? new BN(0);

      const xWithdrew = BN.max(xDelta, new BN(0));
      const yWithdrew = BN.max(yDelta, new BN(0));
      const claimableFeeX = onChainPosition.feeX;
      const claimableFeeY = onChainPosition.feeY;

      console.timeEnd("remConfirm");

      const swapSpecs: SwapSpec[] = [
        { inputMint: xMint, outputMint, amount: xWithdrew, slippageBps: 50 },
        { inputMint: yMint, outputMint, amount: yWithdrew, slippageBps: 50 },
      ];

      console.time("exSwap");
      const swapExecuteRes = await executeSwapsWithNozomi({ userWallet, swapSpecs, maxRetry: 3 });
      if (!swapExecuteRes.ok) {
        //TODO: Handle ux wise the failed swaps (swapExecuteRes.failedSwaps)
        // We can have alert for the user of a failed swap in his dashboard

        // we have  swapExecuteRes.successfulSwaps that contains succesfully swaps ,
        // for now we mark all as failed but this should be handled .
        return {
          status: "failed",
          errorMsg: swapExecuteRes.errorMsg,
        };
      }
      console.timeEnd("exSwap");
      const swapsTxIds = swapExecuteRes.txIds;

      const { totalFeesClaimedInOutputToken, totalReceivedOutToken } = computeTotalFeesClaimedInOutputToken({
        swapQuotes: swapExecuteRes.quotes,
        xMint,
        yMint,
        xWithdrew,
        yWithdrew,
        feeX: claimableFeeX,
        feeY: claimableFeeY,
      });

      console.time("transferMnM");
      const { mnmFeeTransferTxId, mnmFeeRawAmount } = await transferMnMFees({
        userWallet,
        outputMint,
        totalFeesInRawOutputToken: percentageToWithdraw === 100 ? totalFeesClaimedInOutputToken : new BN(0),
      });
      console.timeEnd("transferMnM");

      console.time("DB");
      const transactionIds = [
        { id: removeLiquidityTxId, description: percentageToWithdraw === 100 ? "Close Position" : "Remove Liquidity" },
        ...swapsTxIds.map((id, i) => ({ id, description: `Swap ${i + 1}` })),
      ];
      if (mnmFeeTransferTxId) transactionIds.push({ id: mnmFeeTransferTxId, description: "MnM Fee" });

      console.time("Prices");
      const prices = await getJupiterTokenPrices({ mints: [xMint, yMint, outputMint] });
      const xPrice = prices[xMint]?.usdPrice ?? 0;
      const yPrice = prices[yMint]?.usdPrice ?? 0;
      const collateralPrice = prices[outputMint]?.usdPrice ?? 0;

      console.timeEnd("Prices");

      let activityId = "";
      if (percentageToWithdraw === 100) {
        const tokensData: TokensData = {
          outputToken: {
            mint: outputMint,
            rawAmount: totalReceivedOutToken.toNumber() - mnmFeeRawAmount,
            usdPrice: collateralPrice,
          },
          tokenX: {
            withdrawRaw: xWithdrew.toNumber(),
            claimedFee: claimableFeeX.toNumber(),
            usdPrice: xPrice,
          },
          tokenY: {
            withdrawRaw: yWithdrew.toNumber(),
            claimedFee: claimableFeeY.toNumber(),
            usdPrice: yPrice,
          },
        };
        const pnl = calculatePnl({ position, onChainPosition, tokensData });
        const [id] = await Promise.all([
          ctx.runMutation(internal.tables.activities.mutations.createActivity, {
            userId: user._id,
            input: {
              type: "close_position",
              relatedPositionPubkey: positionPubkey,
              transactionIds,
              details: {
                trigger,
                pnl,
                poolAddress: position.poolAddress,
                positionType: "DLMM",
                ...tokensData,
              },
            },
          }),
          ctx.runMutation(internal.tables.positions.mutations.closePositionByPubkey, { positionPubkey }),
        ]);

        activityId = id;
      } else {
        //this is a partial withdraw, we will deal with that later .
        //create remove liquidity activity
        // calculate realized pnl and add it to the true pnl calculation.
      }
      console.timeEnd("DB");

      return {
        status: "success",
        activityId,
      };
    } catch (error: any) {
      console.error("remove liquidity failed:", error);
      return {
        status: "failed",
        errorMsg: error.message ?? "Something went wrong while removing liquidity.",
      };
    }
  },
});

async function buildRemoveLiquidityTx({
  userAddress,
  positionPubkey,
  dlmmPoolConn,
  fromBinId,
  toBinId,
  percentageToWithdraw,
  options,
}: {
  userAddress: string;
  positionPubkey: string;
  dlmmPoolConn: DLMM;
  fromBinId: number;
  toBinId: number;
  percentageToWithdraw: number;
  options?: {
    useNozomi?: boolean;
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    recentBlockhash: string;
  };
}) {
  // //note: multiple tx only when there is more then 69 bins.
  const [removeTx] = await dlmmPoolConn.removeLiquidity({
    user: new PublicKey(userAddress),
    position: new PublicKey(positionPubkey),
    fromBinId,
    toBinId,
    bps: new BN(Math.round(percentageToWithdraw * 100)),
    shouldClaimAndClose: percentageToWithdraw === 100,
    skipUnwrapSOL: true,
  });

  const cuIxs: TransactionInstruction[] = getCuInstructions({
    limit: options?.cuLimit,
    price: options?.cuPriceMicroLamports,
  });
  //remove Meteora's compute limit and use our own .
  const filteredIxs = removeTx.instructions.filter((ix) => {
    return !ix.programId.equals(ComputeBudgetProgram.programId);
  });

  if (options?.useNozomi) {
    const tipIxn = SystemProgram.transfer({
      fromPubkey: new PublicKey(userAddress),
      toPubkey: new PublicKey(getRandomNozomiTipPubkey()),
      lamports: 1_050_000,
    });
    filteredIxs.push(tipIxn);
  }
  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
    instructions: [...cuIxs, ...filteredIxs],
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);

  return {
    removeTx: versionedTx,
  };
}

// function computeWithdrawAmountsAndFees({
//   positionData,
//   lowerBinId,
//   upperBinId,
//   percentageToWithdraw,
// }: {
//   positionData: PositionData;
//   lowerBinId: number;
//   upperBinId: number;
//   percentageToWithdraw: number;
// }) {
//   let xPositionAmount = new BN(0);
//   let yPositionAmount = new BN(0);

//   let feeX = new BN(0);
//   let feeY = new BN(0);

//   for (const b of positionData.positionBinData) {
//     const binId = b.binId;

//     // Check if bin is inside the active withdraw range
//     if (binId >= lowerBinId && binId <= upperBinId) {
//       const xBinAmount = new BN(b.positionXAmount).muln(percentageToWithdraw / 100);
//       const yBinAmount = new BN(b.positionYAmount).muln(percentageToWithdraw / 100);

//       xPositionAmount = xPositionAmount.add(xBinAmount);
//       yPositionAmount = yPositionAmount.add(yBinAmount);
//     }

//     if (percentageToWithdraw === 100) {
//       // Fees accumulate over ALL bins, independent of range
//       feeX = feeX.add(new BN(b.positionFeeXAmount));
//       feeY = feeY.add(new BN(b.positionFeeYAmount));
//     }
//   }

//   return {
//     xPositionAmount,
//     yPositionAmount,
//     claimableFeeX: feeX,
//     claimableFeeY: feeY,
//   };
// }

function computeTotalFeesClaimedInOutputToken({
  swapQuotes,
  xMint,
  yMint,
  xWithdrew,
  yWithdrew,
  feeX,
  feeY,
}: {
  swapQuotes: NozomiExecutedSwapQuote[];
  xMint: Address;
  yMint: Address;
  xWithdrew: BN;
  yWithdrew: BN;
  feeX: BN;
  feeY: BN;
}) {
  const { outAmountX, outAmountY } = swapQuotes.reduce(
    (acc, q) => {
      const out = new BN(q.outAmount);

      if (q.inputMint === xMint) acc.outAmountX = out;
      if (q.inputMint === yMint) acc.outAmountY = out;

      return acc;
    },
    { outAmountX: new BN(0), outAmountY: new BN(0) }
  );

  let outputFromFeeX = new BN(0);
  let outputFromFeeY = new BN(0);

  if (!xWithdrew.isZero()) {
    outputFromFeeX = outAmountX.mul(feeX).div(xWithdrew);
  }

  if (!yWithdrew.isZero()) {
    outputFromFeeY = outAmountY.mul(feeY).div(yWithdrew);
  }

  return {
    totalFeesClaimedInOutputToken: outputFromFeeX.add(outputFromFeeY),
    totalReceivedOutToken: outAmountX.add(outAmountY),
  };
}

function calculatePnl({
  // ctx, //We will need to fetch remove+add liquidity events in the future as they effect the pnl
  position,
  onChainPosition,
  tokensData,
}: {
  // ctx: ActionCtx;
  position: Doc<"positions">;
  onChainPosition: PositionData;
  tokensData: TokensData;
}) {
  const { tokenX: xInitial, tokenY: yInitial } = position;
  const xMetadata = tokensMetadata[xInitial.mint];
  const yMetadata = tokensMetadata[yInitial.mint];

  const xCurrentPrice = tokensData.tokenX.usdPrice;
  const yCurrentPrice = tokensData.tokenY.usdPrice;

  const xInitialUsdValue = rawAmountToAmount(xInitial.rawAmount, xMetadata.decimals) * xInitial.usdPrice;
  const yInitialUsdValue = rawAmountToAmount(yInitial.rawAmount, yMetadata.decimals) * yInitial.usdPrice;

  const xCurrentUsdValue =
    rawAmountToAmount(parseFloat(onChainPosition.totalXAmount), xMetadata.decimals) * xCurrentPrice;
  const yCurrentUsdValue =
    rawAmountToAmount(parseFloat(onChainPosition.totalYAmount), yMetadata.decimals) * yCurrentPrice;

  const usdAssetPnl = xCurrentUsdValue - xInitialUsdValue + (yCurrentUsdValue - yInitialUsdValue);

  const xTotalFeesRaw = onChainPosition.feeX.add(onChainPosition.totalClaimedFeeXAmount).toNumber();
  const yTotalFeesRaw = onChainPosition.feeY.add(onChainPosition.totalClaimedFeeYAmount).toNumber();
  const usdFeePnl =
    rawAmountToAmount(xTotalFeesRaw, xMetadata.decimals) * tokensData.tokenX.usdPrice +
    rawAmountToAmount(yTotalFeesRaw, yMetadata.decimals) * tokensData.tokenY.usdPrice;

  const totalPnl = usdAssetPnl + usdFeePnl;
  const pctTotalPnl = totalPnl / (xInitialUsdValue + yInitialUsdValue);

  return {
    pctTotalPnl: pctTotalPnl,
    usdAssetPnl,
    usdFeePnl,
    xTotalFeesRaw,
    yTotalFeesRaw,
  };
}

type TokensData = {
  outputToken: {
    mint: Address;
    rawAmount: number;
    usdPrice: number;
  };
  tokenX: {
    withdrawRaw: number;
    claimedFee: number;
    usdPrice: number;
  };
  tokenY: {
    withdrawRaw: number;
    claimedFee: number;
    usdPrice: number;
  };
};
