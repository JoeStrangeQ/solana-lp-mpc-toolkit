// "use node";
// import { v } from "convex/values";
// import { action } from "../../_generated/server";
// import { authenticateUser } from "../../privy";
// import { api, internal } from "../../_generated/api";
// import { getDlmmPoolConn } from "../../services/meteora";
// import {
//   ComputeBudgetProgram,
//   PublicKey,
//   TransactionInstruction,
//   TransactionMessage,
//   VersionedTransaction,
// } from "@solana/web3.js";
// import BN from "bn.js";
// import {
//   tokensMetadata,
//   mints,
//   toAddress,
//   toVersioned,
//   Address,
//   isTokenClose,
//   isAtaCreation,
// } from "../../utils/solana";
// import { rawAmountToAmount, safeBigIntToNumber } from "../../utils/amounts";
// import { getSingleSwapQuote } from "../../services/mnmServer";
// import { buildTitanSwapTransaction } from "../../helpers/buildTitanSwapTransaction";
// import { connection } from "../../convexEnv";
// import { buildTipTx, sendAndConfirmJitoBundle } from "../../helpers/jito";
// import DLMM, { PositionData } from "@meteora-ag/dlmm";
// import { SwapQuotes } from "../../helpers/normalizeServerSwapQuote";
// import { buildTransferTokenTransaction } from "../../helpers/buildTransferTokenTransaction";
// import { Doc, Id } from "../../_generated/dataModel";
// import { vTriggerType } from "../../schema/activities";
// import { sendNozomiTransaction } from "../../helpers/nozomi";

// export const removeLiquidity = action({
//   args: {
//     trigger: vTriggerType,
//     positionPubkey: v.string(),
//     percentageToWithdraw: v.number(),
//     fromBinId: v.optional(v.number()),
//     toBinId: v.optional(v.number()),
//   },
//   handler: async (ctx, args) => {
//     try {
//       const { user, userWallet } = await authenticateUser({ ctx });
//       if (!user) throw new Error("Couldn't find user");
//       const { positionPubkey, percentageToWithdraw, trigger } = args;

//       // //TODO: fetch user settings to know what slippage he is willing to take .
//       const position = await ctx.runQuery(api.tables.positions.get.getPositionByPubkey, { positionPubkey });
//       if (!position) throw new Error(`Position ${positionPubkey} not found`);

//       const dlmmPoolConn = await getDlmmPoolConn(position.poolAddress);

//       const { positionData: onChainPosition } = await dlmmPoolConn.getPosition(new PublicKey(positionPubkey));

//       const { xPositionAmount, yPositionAmount, claimableFeeX, claimableFeeY } = computeWithdrawAndFees({
//         positionData: onChainPosition,
//         lowerBinId: args.fromBinId ?? position.details.lowerBin.id,
//         upperBinId: args.toBinId ?? position.details.upperBin.id,
//       });

//       const userAddress = toAddress(userWallet.address);
//       const xMint = toAddress(position.tokenX.mint);
//       const yMint = toAddress(position.tokenY.mint);
//       const outputMint = toAddress(position.collateral.mint);
//       const outputDecimals = tokensMetadata[outputMint].decimals;
//       if (!outputDecimals) throw new Error("Unknown output token");

//       const xWithdrew = xPositionAmount.add(claimableFeeX);
//       const yWithdrew = yPositionAmount.add(claimableFeeY);
//       const swapSpecs = [
//         { mint: xMint, amount: xWithdrew },
//         { mint: yMint, amount: yWithdrew },
//       ];

//       const swapQuotePromises = swapSpecs
//         .filter(({ mint, amount }) => !amount.isZero() && mint !== outputMint)
//         .map(({ mint, amount }) =>
//           //should do get Single swap quote only when there is not quotes we sending ,
//           // when removing liquidly from the front-end we will show a quote like we doing in create position.
//           getSingleSwapQuote({
//             userAddress,
//             inputMint: mint,
//             outputMint: outputMint,
//             rawAmount: safeBigIntToNumber(amount, `swap ${mint}`),
//             slippageBps: 1000,
//           })
//         );

//       const swapQuotes = await Promise.all(swapQuotePromises);

//       const { blockhash } = await connection.getLatestBlockhash();
//       const { tipTx, cuPriceMicroLamports, cuLimit, tipInLamp } = await buildTipTx({
//         speed: "extraFast",
//         payerAddress: userWallet.address,
//         recentBlockhash: blockhash,
//       });

//       const { removeTx } = await buildRemoveLiquidityTx({
//         userAddress: userWallet.address,
//         dlmmPoolConn,
//         fromBinId: args.fromBinId ?? position.details.lowerBin.id,
//         toBinId: args.toBinId ?? position.details.upperBin.id,
//         percentageToWithdraw,
//         positionPubkey,
//         options: {
//           cuLimit,
//           cuPriceMicroLamports,
//           recentBlockhash: blockhash,
//         },
//       });

//       let outReceivedRawAmount = 0;
//       const swapsTxs = await Promise.all(
//         swapQuotes.map((q) => {
//           const quote = Object.values(q.quotes)[0];
//           if (!quote) {
//             throw new Error("We couldn’t find a valid swap route to the pool’s pair assets.");
//           }
//           outReceivedRawAmount += quote.outAmount;
//           const { instructions, addressLookupTables } = quote;
//           return buildTitanSwapTransaction({
//             userAddress,
//             instructions,
//             lookupTables: addressLookupTables,
//             options: {
//               cuLimit,
//               cuPriceMicroLamports,
//               recentBlockhash: blockhash,
//               removeJitoFrontRun: true,
//             },
//           });
//         })
//       );

//       const transactions: { tx: VersionedTransaction; description: string }[] = [
//         {
//           tx: toVersioned(removeTx),
//           description: percentageToWithdraw === 100 ? "Close Position" : "Remove Liquidity",
//         },
//         ...swapsTxs.map((swapTx, i) => {
//           return {
//             tx: swapTx,
//             description: `Swap #${i + 1}`,
//           };
//         }),
//       ];

//       if (percentageToWithdraw === 100 && (!claimableFeeX.isZero() || !claimableFeeY.isZero())) {
//         const { outFromX, outFromY } = computeOutFromPairTokens({ swapQuotes, xMint, yMint });
//         const { totalOutTokenFee } = computeOutTokenFeeValue({
//           xWithdrew,
//           yWithdrew,
//           outFromX,
//           outFromY,
//           feeX: claimableFeeX,
//           feeY: claimableFeeY,
//         });
//         const mnmFeeClaimTx = await buildTransferTokenTransaction({
//           mint: new PublicKey(outputMint),
//           from: new PublicKey(userAddress),
//           recipient: new PublicKey("ELPSuvvkKDGSXSVoY79akTAJpnyNvS2Yzmmwb4itucxz"),
//           rawAmount: Math.floor(totalOutTokenFee.toNumber() * 0.05),
//           options: {
//             cuLimit,
//             cuPriceMicroLamports,
//             recentBlockhash: blockhash,
//           },
//         });
//         transactions.push({ tx: toVersioned(mnmFeeClaimTx), description: "MnM Fee" });
//       }

//       transactions.push({ tx: tipTx, description: "Jito Tip" });

//       // await sendNozomiTransaction(swapsTxs[0], userWallet);
//       const { txIds, bundleId } = await sendAndConfirmJitoBundle({
//         userWallet,
//         transactions: transactions.map((tx) => tx.tx),
//       });

//       const [xPrice, yPrice, collateralPrice] = await Promise.all([
//         ctx.runAction(api.actions.fetch.tokenPrices.getJupiterTokenPriceAction, {
//           mint: xMint,
//         }),
//         ctx.runAction(api.actions.fetch.tokenPrices.getJupiterTokenPriceAction, {
//           mint: yMint,
//         }),
//         ctx.runAction(api.actions.fetch.tokenPrices.getJupiterTokenPriceAction, {
//           mint: outputMint,
//         }),
//       ]);

//       const transactionIds = transactions.map(({ description }, i) => {
//         return {
//           id: txIds[i],
//           description,
//         };
//       });

//       let activityId = "";
//       if (percentageToWithdraw === 100) {
//         const tokensData: TokensData = {
//           outputToken: {
//             mint: outputMint,
//             rawAmount: outReceivedRawAmount,
//             usdPrice: collateralPrice,
//           },
//           tokenX: {
//             withdrawRaw: xWithdrew.toNumber(),
//             claimedFee: claimableFeeX.toNumber(),
//             usdPrice: xPrice,
//           },
//           tokenY: {
//             withdrawRaw: yWithdrew.toNumber(),
//             claimedFee: claimableFeeY.toNumber(),
//             usdPrice: yPrice,
//           },
//         };
//         const pnl = calculatePnl({ position, onChainPosition, tokensData });
//         const [id] = await Promise.all([
//           ctx.runMutation(internal.tables.activities.mutations.createActivity, {
//             userId: user._id,
//             input: {
//               type: "close_position",
//               relatedPositionPubkey: positionPubkey,
//               transactionIds,
//               details: {
//                 trigger,
//                 bundleId,
//                 pnl,
//                 poolAddress: position.poolAddress,
//                 positionType: "DLMM",
//                 jitoTipLamports: tipInLamp,
//                 ...tokensData,
//               },
//             },
//           }),
//           ctx.runMutation(internal.tables.positions.mutations.closePositionByPubkey, { positionPubkey }),
//         ]);

//         activityId = id;
//       } else {
//         //this is a partial withdraw, we will deal with that later .
//         //create remove liquidity activity
//         // calculate realized pnl and add it to the true pnl calculation.
//       }

//       return {
//         status: "success",
//         result: {
//           activityId,
//           positionPubkey,
//         },
//       };
//     } catch (error: any) {
//       console.error("remove liquidity failed:", error);
//       return {
//         status: "failed",
//         errorMsg: error.message ?? "Something went wrong while removing liquidity.",
//       };
//     }
//   },
// });

// async function buildRemoveLiquidityTx({
//   userAddress,
//   positionPubkey,
//   dlmmPoolConn,
//   fromBinId,
//   toBinId,
//   percentageToWithdraw,
//   options,
// }: {
//   userAddress: string;
//   positionPubkey: string;
//   dlmmPoolConn: DLMM;
//   fromBinId: number;
//   toBinId: number;
//   percentageToWithdraw: number;
//   options?: {
//     cuLimit?: number;
//     cuPriceMicroLamports?: number;
//     recentBlockhash: string;
//     skipAtaCreateIx?: boolean;
//     skipAtaCloseIx?: boolean;
//   };
// }) {
//   // //note: multiple tx only when there is more then 69 bins.
//   const [removeTx] = await dlmmPoolConn.removeLiquidity({
//     user: new PublicKey(userAddress),
//     position: new PublicKey(positionPubkey),
//     fromBinId,
//     toBinId,
//     bps: new BN(Math.round(percentageToWithdraw * 100)),
//     shouldClaimAndClose: percentageToWithdraw === 100,
//     skipUnwrapSOL: true,
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
//   const filteredIxs = removeTx.instructions.filter((ix) => {
//     if (ix.programId.equals(ComputeBudgetProgram.programId)) return false;
//     // if (options?.skipAtaCreateIx && isAtaCreation(ix)) return false;
//     // if (options?.skipAtaCloseIx && isTokenClose(ix)) return false;
//     return true;
//   });

//   // filteredIxs.slice(0, -1);

//   const message = new TransactionMessage({
//     payerKey: new PublicKey(userAddress),
//     recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
//     instructions: [...cuIxs, ...filteredIxs],
//   }).compileToV0Message();

//   const versionedTx = new VersionedTransaction(message);

//   return {
//     removeTx: versionedTx,
//   };
// }

// function calculatePnl({
//   // ctx, //We will need to fetch remove+add liquidity events in the future as they effect the pnl
//   position,
//   onChainPosition,
//   tokensData,
// }: {
//   // ctx: ActionCtx;
//   position: Doc<"positions">;
//   onChainPosition: PositionData;
//   tokensData: TokensData;
// }) {
//   const { tokenX: xInitial, tokenY: yInitial } = position;
//   const xMetadata = tokensMetadata[xInitial.mint];
//   const yMetadata = tokensMetadata[yInitial.mint];

//   const xCurrentPrice = tokensData.tokenX.usdPrice;
//   const yCurrentPrice = tokensData.tokenY.usdPrice;

//   const xInitialUsdValue = rawAmountToAmount(xInitial.rawAmount, xMetadata.decimals) * xInitial.usdPrice;
//   const yInitialUsdValue = rawAmountToAmount(yInitial.rawAmount, yMetadata.decimals) * yInitial.usdPrice;

//   const xCurrentUsdValue =
//     rawAmountToAmount(parseFloat(onChainPosition.totalXAmount), xMetadata.decimals) * xCurrentPrice;
//   const yCurrentUsdValue =
//     rawAmountToAmount(parseFloat(onChainPosition.totalYAmount), yMetadata.decimals) * yCurrentPrice;

//   const usdAssetPnl = xCurrentUsdValue - xInitialUsdValue + (yCurrentUsdValue - yInitialUsdValue);

//   const xTotalFeesRaw = onChainPosition.feeX.add(onChainPosition.totalClaimedFeeXAmount).toNumber();
//   const yTotalFeesRaw = onChainPosition.feeY.add(onChainPosition.totalClaimedFeeYAmount).toNumber();
//   const usdFeePnl =
//     rawAmountToAmount(xTotalFeesRaw, xMetadata.decimals) * tokensData.tokenX.usdPrice +
//     rawAmountToAmount(yTotalFeesRaw, yMetadata.decimals) * tokensData.tokenY.usdPrice;

//   const totalPnl = usdAssetPnl + usdFeePnl;
//   const pctTotalPnl = totalPnl / (xInitialUsdValue + yInitialUsdValue);

//   return {
//     pctTotalPnl: pctTotalPnl,
//     usdAssetPnl,
//     usdFeePnl,
//     xTotalFeesRaw,
//     yTotalFeesRaw,
//   };
// }

// // function adjustSolRent(mint: string, amount: bigint): bigint {
// //   const rent = BigInt(57_000_000);
// //   const res = mint === mints.sol ? amount - rent : amount;
// //   return res > 0n ? res : 0n;
// // }

// function computeWithdrawAndFees({
//   positionData,
//   lowerBinId,
//   upperBinId,
// }: {
//   positionData: PositionData;
//   lowerBinId: number;
//   upperBinId: number;
// }) {
//   let xPositionAmount = new BN(0);
//   let yPositionAmount = new BN(0);

//   let feeX = new BN(0);
//   let feeY = new BN(0);

//   for (const b of positionData.positionBinData) {
//     const binId = b.binId;

//     // Check if bin is inside the active withdraw range
//     if (binId >= lowerBinId && binId <= upperBinId) {
//       xPositionAmount = xPositionAmount.add(new BN(b.positionXAmount));
//       yPositionAmount = yPositionAmount.add(new BN(b.positionYAmount));
//     }

//     // Fees accumulate over ALL bins, independent of range
//     feeX = feeX.add(new BN(b.positionFeeXAmount));
//     feeY = feeY.add(new BN(b.positionFeeYAmount));
//   }

//   return {
//     xPositionAmount,
//     yPositionAmount,
//     claimableFeeX: feeX,
//     claimableFeeY: feeY,
//   };
// }

// function computeOutTokenFeeValue({
//   xWithdrew,
//   yWithdrew,
//   feeX,
//   feeY,
//   outFromX,
//   outFromY,
// }: {
//   xWithdrew: BN;
//   yWithdrew: BN;
//   feeX: BN;
//   feeY: BN;
//   outFromX: BN;
//   outFromY: BN;
// }) {
//   let outputFromFeeX = new BN(0);
//   let outputFromFeeY = new BN(0);

//   if (!xWithdrew.isZero()) {
//     outputFromFeeX = outFromX.mul(feeX).div(xWithdrew);
//   }

//   if (!yWithdrew.isZero()) {
//     outputFromFeeY = outFromY.mul(feeY).div(yWithdrew);
//   }

//   return {
//     outputFromFeeX,
//     outputFromFeeY,
//     totalOutTokenFee: outputFromFeeX.add(outputFromFeeY),
//   };
// }

// function computeOutFromPairTokens({
//   swapQuotes,
//   xMint,
//   yMint,
// }: {
//   swapQuotes: SwapQuotes[];
//   xMint: string;
//   yMint: string;
// }) {
//   let outFromX = new BN(0);
//   let outFromY = new BN(0);

//   for (const quote of swapQuotes) {
//     const route = Object.values(quote.quotes)[0];
//     if (!route) continue;

//     const outAmount = new BN(route.outAmount);
//     const inputMint = quote.inputMint;

//     if (inputMint === xMint) {
//       outFromX = outAmount;
//     } else if (inputMint === yMint) {
//       outFromY = outAmount;
//     }
//   }

//   return { outFromX, outFromY };
// }

// type TokensData = {
//   outputToken: {
//     mint: Address;
//     rawAmount: number;
//     usdPrice: number;
//   };
//   tokenX: {
//     withdrawRaw: number;
//     claimedFee: number;
//     usdPrice: number;
//   };
//   tokenY: {
//     withdrawRaw: number;
//     claimedFee: number;
//     usdPrice: number;
//   };
// };
