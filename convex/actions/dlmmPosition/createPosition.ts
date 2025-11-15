"use node";
import { Infer, v } from "convex/values";
import DLMM, { StrategyParameters, StrategyType } from "@meteora-ag/dlmm";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { vBinIdAndPrice, vDepositedToken, vLiquidityStrategy, vPairToken } from "../../schema/dlmmPosition";
import { authenticateUser } from "../../privy";
import { buildTitanSwapTransaction } from "../../helpers/buildTitanSwapTransaction";
import { action } from "../../_generated/server";
import { getServerSwapQuote, QuoteDetails } from "../../services/mnmServer";
import { ActionRes } from "../../types/actionResults";
import { connection } from "../../convexEnv";
import { buildTipTx, sendAndConfirmJitoBundle } from "../../helpers/jito";
// import { getJupiterTokenPrices } from "../../services/jupiter";
// import { toAddress } from "../../utils/address";
// import { api } from "../../_generated/api";
import { SwapQuotes } from "../../helpers/normalizeServerSwapQuote";
import BN from "bn.js";
import { amountToRawAmount } from "../../utils/amounts";

export const createPosition = action({
  args: {
    quoteDetails: v.array(QuoteDetails),
    poolAddress: v.string(),
    autoCompoundSplit: v.number(),
    minBin: vBinIdAndPrice,
    maxBin: vBinIdAndPrice,
    depositedToken: vDepositedToken,
    tokenX: vPairToken,
    tokenY: vPairToken,
    strategyTypeString: vLiquidityStrategy,
  },
  handler: async (ctx, args): Promise<ActionRes> => {
    try {
      const { user, userWallet } = await authenticateUser({ ctx });
      const {
        tokenX,
        tokenY,
        depositedToken,
        maxBin,
        minBin,
        poolAddress,
        strategyTypeString,
        autoCompoundSplit,
        quoteDetails,
      } = args;

      if (!user) throw new Error("Couldn't find user");
      const getSwapQuotes = quoteDetails.map((q) => getServerSwapQuote({ userId: user._id, ...q }));

      const swapQuotes = await Promise.all(getSwapQuotes);

      const { xRawAmount, yRawAmount, depositedTokenRawAmount } = getPairAmounts({
        swapQuotes,
        depositedToken,
        tokenX,
        tokenY,
      });

      const { blockhash } = await connection.getLatestBlockhash();
      const { tipTx, cuPriceMicroLamports, cuLimit } = await buildTipTx({
        speed: "extraFast",
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
            userAddress: user.address,
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
        userAddress: user.address,
        poolAddress,
        xRawAmount,
        yRawAmount,
        strategy: {
          minBinId: minBin.id,
          maxBinId: maxBin.id,
          strategyType: StrategyType[strategyTypeString],
        },
        options: {
          cuLimit,
          cuPriceMicroLamports,
          recentBlockhash: blockhash,
        },
      });

      // const getTokenPrices = getJupiterTokenPrices({
      //   mints: [toAddress(depositedToken.mint), toAddress(tokenX.mint), toAddress(tokenY.mint)],
      // });

      await sendAndConfirmJitoBundle({
        userWallet,
        txs: [...swapsTxs, createPositionTx, tipTx],
      });

      // const [transactionIds, tokenPrices] = await Promise.all([sendBundle, getTokenPrices]);

      // const tokenDetails = {
      //   depositedToken: {
      //     mint: depositedToken.mint,
      //     rawAmount: depositedTokenRawAmount,
      //     usdPrice: tokenPrices[toAddress(depositedToken.mint)]?.usdPrice ?? 0,
      //   },
      //   tokenX: {
      //     mint: tokenX.mint,
      //     rawAmount: xRawAmount.toNumber(), //TODO: change to string?
      //     usdPrice: tokenPrices[toAddress(tokenX.mint)]?.usdPrice ?? 0,
      //   },
      //   tokenY: {
      //     mint: tokenY.mint,
      //     rawAmount: yRawAmount.toNumber(),
      //     usdPrice: tokenPrices[toAddress(tokenY.mint)]?.usdPrice ?? 0,
      //   },
      // };

      // const swapTransactionsWithDes = [
      //   ...swapsTxs.map((_, i) => {
      //     return {
      //       id: transactionIds[i],
      //       description: `Swap #${i + 1}`,
      //     };
      //   }),
      // ];

      // const [activityId] = await Promise.all([
      //   ctx.runMutation(api.tables.activities.mutations.insertCreatePositionActivity, {
      //     userId: user._id,
      //     status: "success",
      //     details: {
      //       poolAddress,
      //       positionPubkey,
      //       range: `${minBin.price}-${maxBin.price}`,
      //       price: 1,
      //       ...tokenDetails,
      //     },
      //     transactionIds: [
      //       ...swapTransactionsWithDes,
      //       {
      //         id: transactionIds[swapTransactionsWithDes.length],
      //         description: "Create DLMM Position",
      //       },
      //       {
      //         id: transactionIds[swapTransactionsWithDes.length + 1],
      //         description: "Jito Tip",
      //       },
      //     ],
      //   }),
      //   ctx.runMutation(api.tables.DLMMPositions.mutations.createConvexDLMMPosition, {
      //     newPosition: {
      //       userId: user._id,
      //       poolAddress,
      //       autoCompoundSplit,
      //       positionPubkey,
      //       strategy: strategyTypeString,
      //       isActive: true,
      //       lowerBin: minBin,
      //       upperBin: maxBin,
      //       ...tokenDetails,
      //     },
      //   }),
      // ]);

      return {
        status: "success",
        result: {},
        // result: {
        //   activityId,
        //   positionPubkey,
        // },
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
  depositedToken,
  tokenX,
  tokenY,
}: {
  swapQuotes: SwapQuotes[];
  depositedToken: Infer<typeof vDepositedToken>;
  tokenX: Infer<typeof vPairToken>;
  tokenY: Infer<typeof vPairToken>;
}) {
  const depositedTokenRawAmount = amountToRawAmount(depositedToken.amount, depositedToken.decimals);
  const rawAmountTokenX = Math.floor(depositedTokenRawAmount * tokenX.split);
  const rawAmountTokenY = Math.floor(depositedTokenRawAmount * tokenY.split);

  let xRawAmount: BN = new BN(0);
  let yRawAmount: BN = new BN(0);

  for (const quote of swapQuotes) {
    const { outputMint, quotes } = quote;

    const swapRoute = Object.values(quotes)[0];

    if (outputMint === tokenX.mint) {
      xRawAmount = new BN(swapRoute.outAmount);
    } else if (outputMint === tokenY.mint) {
      yRawAmount = new BN(swapRoute.outAmount);
    }
  }

  // if no swap exists for one leg, that side keeps its portion in original token
  if (xRawAmount.isZero() && depositedToken.mint === tokenX.mint) {
    xRawAmount = new BN(rawAmountTokenX);
  }

  if (yRawAmount.isZero() && depositedToken.mint === tokenY.mint) {
    yRawAmount = new BN(rawAmountTokenY);
  }

  return { xRawAmount, yRawAmount, depositedTokenRawAmount };
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
  options?: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    recentBlockhash: string;
  };
}) {
  const dlmmPoolConn = await DLMM.create(connection, new PublicKey(poolAddress));

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
    recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
    instructions: [...cuIxs, ...createPositionIxs],
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign([newPositionKeypair]);

  return {
    createPositionTx: versionedTx,
    positionPubkey: newPositionKeypair.publicKey.toBase58(),
  };
}
