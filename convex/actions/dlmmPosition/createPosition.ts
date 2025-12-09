"use node";
import { Infer, v } from "convex/values";
import { StrategyParameters, StrategyType } from "@meteora-ag/dlmm";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { vBinIdAndPrice, vLiquidityShape } from "../../schema/positions";
import { authenticateUser } from "../../privy";
import { buildTitanSwapTransaction } from "../../helpers/buildTitanSwapTransaction";
import { action } from "../../_generated/server";
import { getServerSwapQuote, vQuoteDetails } from "../../services/mnmServer";
import { ActionRes } from "../../types/actionResults";
import { connection } from "../../convexEnv";
import { buildTipTx, signAndSendJitoBundle } from "../../helpers/jito";
import BN from "bn.js";
import { amountToRawAmount, safeBigIntToNumber } from "../../utils/amounts";
import { getJupiterTokenPrices } from "../../services/jupiter";
import { fastTransactionConfirm, getMarketFromMints, toAddress } from "../../utils/solana";
import { api, internal } from "../../_generated/api";
import { getDlmmPoolConn } from "../../services/meteora";
import { vLimitOrderInput } from "../../schema/limitOrders";
import { buildMultipleJupiterSwapsAtomically, SwapSpec } from "../../helpers/executeSwapsWithNozomi";
import { tryCatch } from "../../utils/tryCatch";

export const vCollateralToken = v.object({
  mint: v.string(),
  decimals: v.number(),
  amount: v.number(),
});

export const vPairToken = v.object({
  mint: v.string(),
  decimals: v.number(),
  split: v.number(), // must be between 0-1
});

export const createPosition = action({
  args: {
    quoteDetails: v.array(vQuoteDetails),
    poolAddress: v.string(),
    autoCompoundSplit: v.number(),
    poolEntryPrice: v.number(),
    lowerBin: vBinIdAndPrice,
    upperBin: vBinIdAndPrice,
    collateral: vCollateralToken,
    tokenX: vPairToken,
    tokenY: vPairToken,
    liquidityShape: vLiquidityShape,
    limits: v.optional(v.object({ sl: v.optional(vLimitOrderInput), tp: v.optional(vLimitOrderInput) })),
  },
  handler: async (ctx, args): Promise<ActionRes<"create_position">> => {
    try {
      const { user, userWallet } = await authenticateUser({ ctx });
      const { tokenX, tokenY, collateral, poolAddress, lowerBin, upperBin, liquidityShape } = args;

      if (!user) throw new Error("Couldn't find user");
      console.time("quotes");
      const getSwapQuotes = args.quoteDetails.map((q) => getServerSwapQuote({ userId: user._id, ...q }));
      const swapQuotesRes = await tryCatch(Promise.all(getSwapQuotes));
      console.timeEnd("quotes");

      const { blockhash } = await connection.getLatestBlockhash();
      const { tipTx, cuPriceMicroLamports, cuLimit } = await buildTipTx({
        speed: "low",
        payerAddress: userWallet.address,
        recentBlockhash: blockhash,
      });

      const swapsTxs: VersionedTransaction[] = [];
      const finalSwapQuotes: NormalizedSwapQuote[] = [];

      const shouldSwapX = collateral.mint !== tokenX.mint && tokenX.split > 0;
      const shouldSwapY = collateral.mint !== tokenY.mint && tokenY.split > 0;

      const validTitanQuotes = swapQuotesRes.data?.filter((q) => Object.values(q.quotes).length > 0);

      if (validTitanQuotes && validTitanQuotes.length > 0) {
        const titanSwapTxs = await Promise.all(
          validTitanQuotes.map((q) => {
            const quote = Object.values(q.quotes)[0];
            if (!quote) {
              throw new Error("We couldn’t find a valid swap route to the pool’s pair assets.");
            }
            const { instructions, addressLookupTables } = quote;
            finalSwapQuotes.push({
              inputMint: q.inputMint,
              outputMint: q.outputMint,
              outAmount: quote.outAmount.toString(),
              slippageBps: quote.slippageBps,
            });
            return buildTitanSwapTransaction({
              userAddress: userWallet.address,
              instructions,
              lookupTables: addressLookupTables,
              options: {
                cuLimit,
                cuPriceMicroLamports,
                recentBlockhash: blockhash,
              },
            });
          })
        );
        swapsTxs.push(...titanSwapTxs);
      } else if (shouldSwapX || shouldSwapY) {
        //titan quotes are empty although we need to have a swap.
        console.log("using jupiter as fallback, no titan quotes but needs a swap");
        const { rawAmountTokenX, rawAmountTokenY } = getPairCollateralAmount({
          collateralUiAmount: collateral.amount,
          collateralDecimals: collateral.decimals,
          xSplit: tokenX.split,
        });

        const swapSpecs: SwapSpec[] = shouldSwapX
          ? [
              {
                amount: new BN(rawAmountTokenX),
                inputMint: toAddress(collateral.mint),
                outputMint: toAddress(tokenX.mint),
                slippageBps: 200,
              },
            ]
          : [];

        if (shouldSwapY) {
          swapSpecs.push({
            amount: new BN(rawAmountTokenY),
            inputMint: toAddress(collateral.mint),
            outputMint: toAddress(tokenY.mint),
            slippageBps: 200,
          });
        }

        const buildJupSwapRes = await buildMultipleJupiterSwapsAtomically({
          userAddress: toAddress(userWallet.address),
          blockhash,
          swapSpecs,
        });
        if (!buildJupSwapRes.ok) throw new Error("Couldn't find a valid swap quote");
        const jupiterSwaps = buildJupSwapRes.swapDetails.map(({ tx }) => tx);
        const jupiterFormattedQuotes: NormalizedSwapQuote[] = buildJupSwapRes.swapDetails.map(({ quote }) => ({
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          outAmount: quote.outAmount,
          slippageBps: quote.slippageBps,
        }));
        swapsTxs.push(...jupiterSwaps);
        finalSwapQuotes.push(...jupiterFormattedQuotes);
      }

      const { xRawAmount, yRawAmount, collateralRawAmount } = getPairAmounts({
        swapQuotes: finalSwapQuotes,
        collateral,
        tokenX,
        tokenY,
      });

      if (xRawAmount.isZero() && yRawAmount.isZero()) {
        throw new Error("Invalid DLMM position: both X and Y amounts are zero.");
      }
      const { createPositionTx, positionPubkey } = await buildCreatePositionTx({
        userAddress: userWallet.address,
        poolAddress,
        xRawAmount: xRawAmount,
        yRawAmount: yRawAmount,
        strategy: {
          minBinId: lowerBin.id,
          maxBinId: upperBin.id,
          strategyType: StrategyType[liquidityShape],
        },
        options: {
          cuLimit,
          cuPriceMicroLamports,
          recentBlockhash: blockhash,
        },
      });

      //TODO: Change token prices to get from our mnm-server using switchboard
      const getTokenPrices = getJupiterTokenPrices({
        mints: [toAddress(collateral.mint), toAddress(tokenX.mint), toAddress(tokenY.mint)],
      });

      const sendBundle = signAndSendJitoBundle({
        userWallet,
        transactions: [...swapsTxs, createPositionTx, tipTx],
      });

      const [{ txIds, bundleId }, tokenPrices] = await Promise.all([sendBundle, getTokenPrices]);
      const createPositionTxId = txIds[txIds.length - 2];
      const txsConfirmRes = await fastTransactionConfirm([createPositionTxId], 10_000);

      if (txsConfirmRes[0].err) {
        throw new Error(
          `Transaction ${txsConfirmRes[0].signature} failed: ${JSON.stringify(txsConfirmRes[0].err ?? "couldn't confirm the transaction")}`
        );
      }
      console.time("db");

      const tokenDetails = {
        collateral: {
          mint: collateral.mint,
          rawAmount: collateralRawAmount,
          usdPrice: tokenPrices[toAddress(collateral.mint)]?.usdPrice ?? 0,
        },
        tokenX: {
          mint: tokenX.mint,
          rawAmount: safeBigIntToNumber(xRawAmount),
          usdPrice: tokenPrices[toAddress(tokenX.mint)]?.usdPrice ?? 0,
        },
        tokenY: {
          mint: tokenY.mint,
          rawAmount: safeBigIntToNumber(yRawAmount),
          usdPrice: tokenPrices[toAddress(tokenY.mint)]?.usdPrice ?? 0,
        },
      };

      const swapTransactionsWithDes = swapsTxs.map((_, i) => ({
        id: txIds[i],
        description: `Swap #${i + 1}`,
      }));

      const transactionIds = [
        ...swapTransactionsWithDes,
        { id: txIds[swapsTxs.length], description: "Create DLMM Position" },
        { id: txIds[swapsTxs.length + 1], description: "Jito Tip" },
      ];

      const ordersToCreate = [];
      if (args.limits?.sl) {
        ordersToCreate.push(
          ctx.runMutation(api.tables.orders.mutations.createOrder, {
            userId: user._id,
            direction: "sl",
            market: getMarketFromMints(tokenX.mint, tokenY.mint),
            orderInput: args.limits.sl,
            percentageToWithdraw: 100,
            positionPubkey,
          })
        );
      }

      if (args.limits?.tp) {
        ordersToCreate.push(
          ctx.runMutation(api.tables.orders.mutations.createOrder, {
            userId: user._id,
            direction: "tp",
            market: getMarketFromMints(tokenX.mint, tokenY.mint),
            orderInput: args.limits.tp,
            percentageToWithdraw: 100,
            positionPubkey,
          })
        );
      }
      const [activityId] = await Promise.all([
        ctx.runMutation(internal.tables.activities.mutations.createActivity, {
          userId: user._id,
          input: {
            type: "create_position",
            relatedPositionPubkey: positionPubkey,
            transactionIds,
            bundleId,
            details: {
              poolAddress,
              positionType: "DLMM",
              range: `${lowerBin.price}-${upperBin.price}`,
              ...tokenDetails,
            },
          },
        }),
        ctx.runMutation(internal.tables.positions.mutations.insertPosition, {
          userId: user._id,
          input: {
            type: "DLMM",
            poolAddress,
            positionPubkey,
            poolEntryPrice: args.poolEntryPrice,
            details: {
              autoCompoundSplit: args.autoCompoundSplit,
              lowerBin: lowerBin,
              upperBin: upperBin,
              liquidityStrategy: liquidityShape,
            },
            ...tokenDetails,
          },
        }),
        ...ordersToCreate,
      ]);
      console.timeEnd("db");

      return {
        status: "success",
        result: {
          activityId,
          positionPubkey,
          createPositionTxId: txIds[txIds.length - 2],
        },
      };
    } catch (error: any) {
      console.error("CreatePosition failed:", error);
      return {
        status: "failed",
        errorMsg: error?.message ?? "Something went wrong while creating the position.",
      };
    }
  },
});

type NormalizedSwapQuote = {
  inputMint: string;
  outputMint: string;
  outAmount: string; // raw, before slippage
  slippageBps?: number; // optional
};

export function getPairAmounts({
  swapQuotes,
  collateral,
  tokenX,
  tokenY,
}: {
  swapQuotes: NormalizedSwapQuote[];
  collateral: Infer<typeof vCollateralToken>;
  tokenX: Infer<typeof vPairToken>;
  tokenY: Infer<typeof vPairToken>;
}) {
  const { collateralRawAmount, rawAmountTokenX, rawAmountTokenY } = getPairCollateralAmount({
    collateralUiAmount: collateral.amount,
    collateralDecimals: collateral.decimals,
    xSplit: tokenX.split,
  });

  let xRawAmount = new BN(0);
  let yRawAmount = new BN(0);

  for (const quote of swapQuotes) {
    const out = new BN(quote.outAmount);
    const slippageBps = (quote.slippageBps ?? 0) + 5; // your safety margin

    const minOut = out.mul(new BN(10_000 - slippageBps)).div(new BN(10_000));

    if (quote.outputMint === tokenX.mint) {
      xRawAmount = minOut;
    }

    if (quote.outputMint === tokenY.mint) {
      yRawAmount = minOut;
    }
  }

  if (xRawAmount.isZero() && collateral.mint === tokenX.mint) {
    xRawAmount = new BN(rawAmountTokenX);
  }

  if (yRawAmount.isZero() && collateral.mint === tokenY.mint) {
    yRawAmount = new BN(rawAmountTokenY);
  }

  //  Final safety in case of misconfigured split
  if (tokenX.split === 0) xRawAmount = new BN(0);
  if (tokenX.split === 1) yRawAmount = new BN(0);

  return {
    xRawAmount,
    yRawAmount,
    collateralRawAmount,
  };
}

function getPairCollateralAmount({
  collateralUiAmount,
  collateralDecimals,
  xSplit,
}: {
  collateralUiAmount: number;
  collateralDecimals: number;
  xSplit: number;
}) {
  const collateralRawAmount = amountToRawAmount(collateralUiAmount, collateralDecimals);
  const rawAmountTokenX = Math.floor(collateralRawAmount * xSplit);
  const rawAmountTokenY = Math.floor(collateralRawAmount * (1 - xSplit));

  return { collateralRawAmount, rawAmountTokenX, rawAmountTokenY };
}

async function buildCreatePositionTx({
  userAddress,
  poolAddress,
  strategy,
  xRawAmount,
  yRawAmount,
  options,
}: {
  userAddress: string;
  poolAddress: string;
  xRawAmount: BN;
  yRawAmount: BN;
  strategy: StrategyParameters;
  options: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    recentBlockhash: string;
  };
}) {
  const dlmmPoolConn = await getDlmmPoolConn(poolAddress);

  const newPositionKeypair = new Keypair();

  const createPositionTx = await dlmmPoolConn.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: newPositionKeypair.publicKey,
    user: new PublicKey(userAddress),
    totalXAmount: xRawAmount,
    totalYAmount: yRawAmount,
    strategy,
  });

  const cuIxs: TransactionInstruction[] = [];
  if (options?.cuLimit || options?.cuPriceMicroLamports) {
    cuIxs.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: options.cuLimit ?? 1_000_000,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.cuPriceMicroLamports ?? 1_000_000,
      })
    );
  }

  //remove Meteora's compute limit and use our own .
  const createPositionIxs = createPositionTx.instructions.filter((ix) => {
    const isComputeBudget = ix.programId.equals(ComputeBudgetProgram.programId);
    return !isComputeBudget;
  });

  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash: options.recentBlockhash,
    instructions: [...cuIxs, ...createPositionIxs],
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign([newPositionKeypair]);

  return {
    createPositionTx: versionedTx,
    positionPubkey: newPositionKeypair.publicKey.toBase58(),
  };
}
