"use node";
import { v } from "convex/values";
import { action } from "../../_generated/server";
import { authenticateUser } from "../../privy";
import { api, internal } from "../../_generated/api";
import { getDlmmPoolConn } from "../../services/meteora";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  tokensMetadata,
  toAddress,
  toVersioned,
  Address,
  getCuInstructions,
  mints,
  fastTransactionConfirm,
} from "../../utils/solana";
import { rawAmountToAmount, safeBigIntToNumber } from "../../utils/amounts";
import { connection } from "../../convexEnv";
import { buildTipTx, signAndSendJitoBundle } from "../../helpers/jito";
import DLMM, { PositionData } from "@meteora-ag/dlmm";
import { Doc, Id } from "../../_generated/dataModel";
import { vTriggerType } from "../../schema/activities";
import { buildJupSwapTransaction } from "../../helpers/buildJupiterSwapTransaction";
import { simulateAndGetTokensBalance } from "../../helpers/simulateAndGetTokensBalance";
import { tryCatch } from "../../utils/tryCatch";
import { SwapSpec } from "../../helpers/executeSwapsWithNozomi";
import { getJupiterTokenPrices, JupQuoteResponse } from "../../services/jupiter";
import { buildTransferMnMTx } from "../../helpers/transferMnMFees";
import { ActionRes } from "../../types/actionResults";

export const removeLiquidity = action({
  args: {
    trigger: vTriggerType,
    positionPubkey: v.string(),
    percentageToWithdraw: v.number(),
    fromBinId: v.optional(v.number()),
    toBinId: v.optional(v.number()),
    //TODO: add optional fee amounts and swap quotes (when preforming from the front-end)
  },
  handler: async (ctx, args): Promise<ActionRes<"close_position">> => {
    try {
      const { user, userWallet } = await authenticateUser({ ctx });
      if (!user) throw new Error("Couldn't find user");
      const { positionPubkey, percentageToWithdraw, trigger } = args;

      // //TODO: fetch user settings to know what slippage he is willing to take .
      const position = await ctx.runQuery(api.tables.positions.get.getPositionByPubkey, { positionPubkey });
      if (!position) throw new Error(`Position ${positionPubkey} not found`);

      const dlmmPoolConn = await getDlmmPoolConn(position.poolAddress);
      const { positionData: onChainPosition } = await dlmmPoolConn.getPosition(new PublicKey(positionPubkey));

      const userAddress = toAddress(userWallet.address);
      const xMint = toAddress(position.tokenX.mint);
      const yMint = toAddress(position.tokenY.mint);
      const outputMint = toAddress(position.collateral.mint);

      const claimableFeeX = onChainPosition.feeX;
      const claimableFeeY = onChainPosition.feeY;

      const { blockhash } = await connection.getLatestBlockhash();
      const { tipTx, cuPriceMicroLamports, cuLimit } = await buildTipTx({
        speed: "fast",
        payerAddress: userWallet.address,
        recentBlockhash: blockhash,
      });

      const { removeTx, xRemoved, yRemoved } = await buildAndSimulateRemoveLiquidityTx({
        userAddress,
        dlmmPoolConn,
        fromBinId: args.fromBinId ?? position.details.lowerBin.id,
        toBinId: args.toBinId ?? position.details.upperBin.id,
        percentageToWithdraw,
        positionPubkey,
        options: {
          cuLimit,
          cuPriceMicroLamports,
          recentBlockhash: blockhash,
        },
      });

      const swapSpecs: SwapSpec[] = [
        { inputMint: xMint, outputMint, amount: xRemoved, slippageBps: 150 },
        { inputMint: yMint, outputMint, amount: yRemoved, slippageBps: 150 },
      ];

      const buildSwaps = swapSpecs
        .filter(({ inputMint, amount }) => !amount.isZero() && inputMint !== outputMint)
        .map(async ({ inputMint, amount, slippageBps }) => {
          return buildJupSwapTransaction({
            userAddress,
            inputMint,
            inputAmount: safeBigIntToNumber(amount, `Swap ${inputMint}`),
            outputMint,
            blockhash,
            slippageBps,
          });
        });

      const swapsRes = await tryCatch(Promise.all(buildSwaps));
      if (swapsRes.error) {
        return {
          status: "failed",
          errorMsg: "Couldn't build swaps",
        };
      }

      const transactions: { tx: VersionedTransaction; description: string }[] = [
        {
          tx: toVersioned(removeTx),
          description: percentageToWithdraw === 100 ? "Close Position" : "Remove Liquidity",
        },
        ...swapsRes.data.map(({ tx }, i) => ({
          tx,
          description: `Swap #${i + 1}`,
        })),
      ];

      const { totalFeesClaimedInOutputToken, totalReceivedOutToken } = computeTotalFeesClaimedInOutputToken({
        swapQuotes: swapsRes.data.map((s) => s.quote),
        xMint,
        yMint,
        xRemoved,
        yRemoved,
        feeX: claimableFeeX,
        feeY: claimableFeeY,
      });

      let tokenOutputAmount = safeBigIntToNumber(totalReceivedOutToken, "tokenOutputAmount");
      if (percentageToWithdraw === 100 && (!claimableFeeX.isZero() || !claimableFeeY.isZero())) {
        const mnmFeeClaimTxRes = await buildTransferMnMTx({
          userWallet,
          outputMint,
          totalFeesInRawOutputToken: totalFeesClaimedInOutputToken,
        });

        if (mnmFeeClaimTxRes) {
          transactions.push({ tx: toVersioned(mnmFeeClaimTxRes.mnmFeeClaimTx), description: "MnM Fee" });
          tokenOutputAmount = tokenOutputAmount - mnmFeeClaimTxRes.mnmFeeRawAmount;
        }
      }

      transactions.push({ tx: tipTx, description: "Jito Tip" });

      const { txIds } = await signAndSendJitoBundle({
        userWallet,
        transactions: transactions.map((tx) => tx.tx),
      });

      const txsConfirmRes = await fastTransactionConfirm([txIds[0]], 7_000);
      if (txsConfirmRes[0].err) {
        throw new Error(`Transaction ${txsConfirmRes[0].signature} failed: ${JSON.stringify(txsConfirmRes[0].err)}`);
      }

      const prices = await getJupiterTokenPrices({ mints: [xMint, yMint, outputMint] });
      const xPrice = prices[xMint]?.usdPrice ?? 0;
      const yPrice = prices[yMint]?.usdPrice ?? 0;
      const collateralPrice = prices[outputMint]?.usdPrice ?? 0;

      const transactionIds = transactions.map(({ description }, i) => {
        return {
          id: txIds[i],
          description,
        };
      });
      let activityId = "" as Id<"activities">;
      if (percentageToWithdraw === 100) {
        const tokensData: TokensData = {
          outputToken: {
            mint: outputMint,
            rawAmount: tokenOutputAmount,
            usdPrice: collateralPrice,
          },
          tokenX: {
            withdrawRaw: xRemoved.toNumber(),
            claimedFee: claimableFeeX.toNumber(),
            usdPrice: xPrice,
          },
          tokenY: {
            withdrawRaw: yRemoved.toNumber(),
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
        result: { activityId, closedPositionId: "" },
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

async function buildAndSimulateRemoveLiquidityTx({
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
  options: {
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
  });

  const cuIxs: TransactionInstruction[] = getCuInstructions({
    limit: options?.cuLimit,
    price: options?.cuPriceMicroLamports,
  });
  //remove Meteora's compute limit and use our own .
  const filteredIxs = removeTx.instructions.filter((ix) => {
    return !ix.programId.equals(ComputeBudgetProgram.programId);
  });

  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
    instructions: [...cuIxs, ...filteredIxs],
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);

  const simRes = await simulateAndGetTokensBalance({ userAddress: toAddress(userAddress), transaction: versionedTx });

  if (simRes.sim.err) {
    throw new Error("Failed to simulate remove liquidity transaction");
  }

  const xMint = dlmmPoolConn.lbPair.tokenXMint.toBase58();
  const yMint = dlmmPoolConn.lbPair.tokenYMint.toBase58();
  console.log("x removed", simRes.tokenBalancesChange[xMint].rawAmount.toString());
  console.log("y removed", simRes.tokenBalancesChange[yMint].rawAmount.toString());
  const xDelta = simRes.tokenBalancesChange[xMint]?.rawAmount ?? new BN(0);
  const yDelta = simRes.tokenBalancesChange[yMint]?.rawAmount ?? new BN(0);
  const xRemoved = BN.max(adjustSolRent(xMint, xDelta), new BN(0));
  const yRemoved = BN.max(adjustSolRent(yMint, yDelta), new BN(0));
  return {
    removeTx: versionedTx,
    xRemoved,
    yRemoved,
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

function adjustSolRent(mint: string, amount: BN): BN {
  const rent = new BN(57000000);
  const res = mint === mints.sol ? amount.sub(rent) : amount;
  return res.isNeg() ? new BN(0) : res;
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

function computeTotalFeesClaimedInOutputToken({
  swapQuotes,
  xMint,
  yMint,
  xRemoved,
  yRemoved,
  feeX,
  feeY,
}: {
  swapQuotes: JupQuoteResponse[];
  xMint: Address;
  yMint: Address;
  xRemoved: BN;
  yRemoved: BN;
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

  if (!xRemoved.isZero()) {
    outputFromFeeX = outAmountX.mul(feeX).div(xRemoved);
  }

  if (!yRemoved.isZero()) {
    outputFromFeeY = outAmountY.mul(feeY).div(yRemoved);
  }

  return {
    totalFeesClaimedInOutputToken: outputFromFeeX.add(outputFromFeeY),
    totalReceivedOutToken: outAmountX.add(outAmountY),
  };
}
