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
import { SwapQuotes } from "../../helpers/normalizeServerSwapQuote";
import BN from "bn.js";
import { amountToRawAmount, safeBigIntToNumber } from "../../utils/amounts";
import { getJupiterTokenPrices } from "../../services/jupiter";
import { fastTransactionConfirm, getMarketFromMints, toAddress } from "../../utils/solana";
import { api, internal } from "../../_generated/api";
import { getDlmmPoolConn } from "../../services/meteora";
import { vLimitOrderInput } from "../../schema/limitOrders";

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
      const swapQuotes = await Promise.all(getSwapQuotes);
      console.timeEnd("quotes");

      const { xRawAmount, yRawAmount, collateralRawAmount } = getPairAmounts({
        swapQuotes,
        collateral,
        tokenX,
        tokenY,
      });

      const { blockhash } = await connection.getLatestBlockhash();
      const { tipTx, cuPriceMicroLamports, cuLimit } = await buildTipTx({
        speed: "low",
        payerAddress: userWallet.address,
        recentBlockhash: blockhash,
      });

      const swapsTxs = await Promise.all(
        swapQuotes.map((q) => {
          const quote = Object.values(q.quotes)[0];
          if (!quote) {
            throw new Error("We couldn’t find a valid swap route to the pool’s pair assets.");
          }
          const { instructions, addressLookupTables } = quote;
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
      const txsConfirmRes = await fastTransactionConfirm([createPositionTxId], 7_000);

      if (txsConfirmRes[0].err) {
        throw new Error(`Transaction ${txsConfirmRes[0].signature} failed: ${JSON.stringify(txsConfirmRes[0].err)}`);
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
        errorMsg: error.message ?? "Something went wrong while creating the position.",
      };
    }
  },
});

export function getPairAmounts({
  swapQuotes,
  collateral,
  tokenX,
  tokenY,
}: {
  swapQuotes: SwapQuotes[];
  collateral: Infer<typeof vCollateralToken>;
  tokenX: Infer<typeof vPairToken>;
  tokenY: Infer<typeof vPairToken>;
}) {
  const collateralRawAmount = amountToRawAmount(collateral.amount, collateral.decimals);
  const rawAmountTokenX = Math.floor(collateralRawAmount * tokenX.split);
  const rawAmountTokenY = Math.floor(collateralRawAmount * tokenY.split);

  let xRawAmount: BN = new BN(0);
  let yRawAmount: BN = new BN(0);

  for (const quote of swapQuotes) {
    const { outputMint, quotes } = quote;

    const swapRoute = Object.values(quotes)[0];
    if (!swapRoute) throw new Error(`Couldn't find swap routes for ${quote.inputMint}-> ${quote.outputMint}`);

    const out = new BN(swapRoute.outAmount);
    const slippageBps = (swapRoute.slippageBps ?? 0) + 5; //+5 to add a little bit of margin of our own

    // Apply slippage: minOut = out * (10000 - slippageBps) / 10000
    const minOut = out.mul(new BN(10_000 - slippageBps)).div(new BN(10_000));

    if (outputMint === tokenX.mint) {
      xRawAmount = minOut;
    } else if (outputMint === tokenY.mint) {
      yRawAmount = minOut;
    }
  }

  // If no swap, fall back to raw split amounts
  if (xRawAmount.isZero() && collateral.mint === tokenX.mint) {
    xRawAmount = new BN(rawAmountTokenX);
  }

  if (yRawAmount.isZero() && collateral.mint === tokenY.mint) {
    yRawAmount = new BN(rawAmountTokenY);
  }

  return { xRawAmount, yRawAmount, collateralRawAmount };
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
