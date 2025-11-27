// "use node";
// import { Infer, v } from "convex/values";
// import DLMM, { StrategyParameters, StrategyType } from "@meteora-ag/dlmm";
// import {
//   ComputeBudgetProgram,
//   Keypair,
//   PublicKey,
//   TransactionInstruction,
//   TransactionMessage,
//   VersionedTransaction,
// } from "@solana/web3.js";
// import { vBinIdAndPrice, vLiquidityStrategy } from "../../schema/positions";
// import { authenticateUser } from "../../privy";
// import { buildTitanSwapTransaction } from "../../helpers/buildTitanSwapTransaction";
// import { action } from "../../_generated/server";
// import { getServerSwapQuote, vQuoteDetails } from "../../services/mnmServer";
// import { ActionRes } from "../../types/actionResults";
// import { connection } from "../../convexEnv";
// import { buildTipTx, sendAndConfirmJitoBundle } from "../../helpers/jito";
// import { SwapQuotes } from "../../helpers/normalizeServerSwapQuote";
// import BN from "bn.js";
// import { amountToRawAmount } from "../../utils/amounts";
// import { getJupiterTokenPrices } from "../../services/jupiter";
// import { toAddress } from "../../utils/solana";
// import { internal } from "../../_generated/api";

// export const vCollateralToken = v.object({
//   mint: v.string(),
//   decimals: v.number(),
//   amount: v.number(),
// });

// export const vPairToken = v.object({
//   mint: v.string(),
//   decimals: v.number(),
//   split: v.number(), // must be between 0-1
// });

// export const createPosition = action({
//   args: {
//     quoteDetails: v.array(vQuoteDetails),
//     poolAddress: v.string(),
//     autoCompoundSplit: v.number(),
//     minBin: vBinIdAndPrice,
//     maxBin: vBinIdAndPrice,
//     collateral: vCollateralToken,
//     tokenX: vPairToken,
//     tokenY: vPairToken,
//     strategyTypeString: vLiquidityStrategy,
//   },
//   handler: async (ctx, args): Promise<ActionRes> => {
//     try {
//       const { user, userWallet } = await authenticateUser({ ctx });
//       const {
//         tokenX,
//         tokenY,
//         collateral,
//         maxBin,
//         minBin,
//         poolAddress,
//         strategyTypeString,
//         autoCompoundSplit,
//         quoteDetails,
//       } = args;

//       if (!user) throw new Error("Couldn't find user");
//       console.time("Timer2");
//       const getSwapQuotes = quoteDetails.map((q) => getServerSwapQuote({ userId: user._id, ...q }));

//       const swapQuotes = await Promise.all(getSwapQuotes);
//       console.timeEnd("Timer2");

//       const { xRawAmount, yRawAmount, collateralRawAmount } = getPairAmounts({
//         swapQuotes,
//         collateral,
//         tokenX,
//         tokenY,
//       });

//       const { blockhash } = await connection.getLatestBlockhash();
//       const { tipTx, cuPriceMicroLamports, cuLimit, tipInLamp } = await buildTipTx({
//         speed: "extraFast",
//         payerAddress: userWallet.address,
//         recentBlockhash: blockhash,
//       });

//       const swapsTxs = await Promise.all(
//         swapQuotes.map((q) => {
//           const quote = Object.values(q.quotes)[0];
//           if (!quote) {
//             throw new Error("We couldn’t find a valid swap route to the pool’s pair assets.");
//           }
//           const { instructions, addressLookupTables } = quote;
//           return buildTitanSwapTransaction({
//             userAddress: userWallet.address,
//             instructions,
//             lookupTables: addressLookupTables,
//             options: {
//               cuLimit,
//               cuPriceMicroLamports,
//               recentBlockhash: blockhash,
//             },
//           });
//         })
//       );

//       const { createPositionTx, positionPubkey } = await buildCreatePositionTx({
//         userAddress: userWallet.address,
//         poolAddress,
//         xRawAmount: xRawAmount.muln(0.95),
//         yRawAmount: yRawAmount.muln(0.95),
//         strategy: {
//           minBinId: minBin.id,
//           maxBinId: maxBin.id,
//           strategyType: StrategyType[strategyTypeString],
//         },
//         options: {
//           cuLimit,
//           cuPriceMicroLamports,
//           recentBlockhash: blockhash,
//         },
//       });

//       const getTokenPrices = getJupiterTokenPrices({
//         mints: [toAddress(collateral.mint), toAddress(tokenX.mint), toAddress(tokenY.mint)],
//       });

//       const sendBundle = sendAndConfirmJitoBundle({
//         userWallet,
//         transactions: [...swapsTxs, createPositionTx, tipTx],
//       });

//       const [{ txIds, bundleId }, tokenPrices] = await Promise.all([sendBundle, getTokenPrices]);

//       const tokenDetails = {
//         collateral: {
//           mint: collateral.mint,
//           rawAmount: collateralRawAmount,
//           usdPrice: tokenPrices[toAddress(collateral.mint)]?.usdPrice ?? 0,
//         },
//         tokenX: {
//           mint: tokenX.mint,
//           rawAmount: xRawAmount.toNumber(),
//           usdPrice: tokenPrices[toAddress(tokenX.mint)]?.usdPrice ?? 0,
//         },
//         tokenY: {
//           mint: tokenY.mint,
//           rawAmount: yRawAmount.toNumber(),
//           usdPrice: tokenPrices[toAddress(tokenY.mint)]?.usdPrice ?? 0,
//         },
//       };

//       const swapTransactionsWithDes = [
//         ...swapsTxs.map((_, i) => {
//           return {
//             id: txIds[i],
//             description: `Swap #${i + 1}`,
//           };
//         }),
//       ];

//       const transactionIds = [
//         ...swapTransactionsWithDes,
//         {
//           id: txIds[swapTransactionsWithDes.length],
//           description: "Create DLMM Position",
//         },
//         {
//           id: txIds[swapTransactionsWithDes.length + 1],
//           description: "Jito Tip",
//         },
//       ];

//       const [activityId] = await Promise.all([
//         ctx.runMutation(internal.tables.activities.mutations.createActivity, {
//           userId: user._id,
//           input: {
//             type: "create_position",
//             relatedPositionPubkey: positionPubkey,
//             transactionIds,
//             details: {
//               poolAddress,
//               positionType: "DLMM",
//               range: `${minBin.price}-${maxBin.price}`,
//               ...tokenDetails,
//             },
//           },
//         }),

//         ctx.runMutation(internal.tables.positions.mutations.insertPosition, {
//           userId: user._id,
//           input: {
//             type: "DLMM",
//             poolAddress,
//             positionPubkey,
//             details: {
//               autoCompoundSplit,
//               lowerBin: minBin,
//               upperBin: maxBin,
//               liquidityStrategy: strategyTypeString,
//             },
//             ...tokenDetails,
//           },
//         }),
//       ]);

//       return {
//         status: "success",
//         result: {
//           activityId,
//           positionPubkey,
//         },
//       };
//     } catch (error: any) {
//       console.error("CreatePosition failed:", error);
//       return {
//         status: "failed",
//         errorMsg: error.message ?? "Something went wrong while creating the position.",
//       };
//     }
//   },
// });

// export function getPairAmounts({
//   swapQuotes,
//   collateral,
//   tokenX,
//   tokenY,
// }: {
//   swapQuotes: SwapQuotes[];
//   collateral: Infer<typeof vCollateralToken>;
//   tokenX: Infer<typeof vPairToken>;
//   tokenY: Infer<typeof vPairToken>;
// }) {
//   const collateralRawAmount = amountToRawAmount(collateral.amount, collateral.decimals);
//   const rawAmountTokenX = Math.floor(collateralRawAmount * tokenX.split);
//   const rawAmountTokenY = Math.floor(collateralRawAmount * tokenY.split);

//   let xRawAmount: BN = new BN(0);
//   let yRawAmount: BN = new BN(0);

//   for (const quote of swapQuotes) {
//     const { outputMint, quotes } = quote;

//     const swapRoute = Object.values(quotes)[0];

//     if (outputMint === tokenX.mint) {
//       xRawAmount = new BN(swapRoute.outAmount);
//     } else if (outputMint === tokenY.mint) {
//       yRawAmount = new BN(swapRoute.outAmount);
//     }
//   }

//   // if no swap exists for one leg, that side keeps its portion in original token
//   if (xRawAmount.isZero() && collateral.mint === tokenX.mint) {
//     xRawAmount = new BN(rawAmountTokenX);
//   }

//   if (yRawAmount.isZero() && collateral.mint === tokenY.mint) {
//     yRawAmount = new BN(rawAmountTokenY);
//   }

//   return { xRawAmount, yRawAmount, collateralRawAmount };
// }

// async function buildCreatePositionTx({
//   userAddress,
//   poolAddress,
//   strategy,
//   xRawAmount,
//   yRawAmount,
//   options,
// }: {
//   userAddress: string;
//   poolAddress: string;
//   xRawAmount: BN;
//   yRawAmount: BN;
//   strategy: StrategyParameters;
//   options?: {
//     cuLimit?: number;
//     cuPriceMicroLamports?: number;
//     recentBlockhash: string;
//   };
// }) {
//   const dlmmPoolConn = await DLMM.create(connection, new PublicKey(poolAddress));

//   const newPositionKeypair = new Keypair();

//   const createPositionTx = await dlmmPoolConn.initializePositionAndAddLiquidityByStrategy({
//     positionPubKey: newPositionKeypair.publicKey,
//     user: new PublicKey(userAddress),
//     totalXAmount: xRawAmount,
//     totalYAmount: yRawAmount,
//     strategy,
//     slippage: 10,
//   });

//   const cuIxs: TransactionInstruction[] = [];
//   if (options?.cuLimit || options?.cuPriceMicroLamports) {
//     cuIxs.push(
//       ComputeBudgetProgram.setComputeUnitLimit({
//         units: options.cuLimit ?? 1_000_000,
//       }),
//       ComputeBudgetProgram.setComputeUnitPrice({
//         microLamports: options.cuPriceMicroLamports ?? 1_000_000,
//       })
//     );
//   }

//   //remove Meteora's compute limit and use our own .
//   const createPositionIxs = createPositionTx.instructions.filter((ix) => {
//     const isComputeBudget = ix.programId.equals(ComputeBudgetProgram.programId);
//     return !isComputeBudget;
//   });

//   const message = new TransactionMessage({
//     payerKey: new PublicKey(userAddress),
//     recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
//     instructions: [...cuIxs, ...createPositionIxs],
//   }).compileToV0Message();

//   const versionedTx = new VersionedTransaction(message);
//   versionedTx.sign([newPositionKeypair]);

//   return {
//     createPositionTx: versionedTx,
//     positionPubkey: newPositionKeypair.publicKey.toBase58(),
//   };
// }
