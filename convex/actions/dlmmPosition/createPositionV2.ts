// "use node";
// import { v } from "convex/values";
// import { action } from "../../_generated/server";
// import { getServerSwapQuote, vQuoteDetails } from "../../services/mnmServer";
// import { vBinIdAndPrice, vLiquidityShape } from "../../schema/positions";
// import { ActionRes } from "../../types/actionResults";
// import { authenticateUser, PrivyWallet } from "../../privy";
// import { amountToRawAmount, safeBigIntToNumber } from "../../utils/amounts";
// import BN from "bn.js";
// import { executeSwapsWithNozomi, SwapSpec } from "../../helpers/executeSwapsWithNozomi";
// import DLMM, { StrategyParameters, StrategyType } from "@meteora-ag/dlmm";
// import {
//   ComputeBudgetProgram,
//   Keypair,
//   PublicKey,
//   SystemProgram,
//   TransactionInstruction,
//   TransactionMessage,
//   VersionedTransaction,
// } from "@solana/web3.js";
// import { connection } from "../../convexEnv";
// import { Address, getCuInstructions, toAddress } from "../../utils/solana";
// import { getRandomNozomiTipPubkey, sendNozomiTransaction } from "../../helpers/nozomi";
// import { getJupiterTokenPrices } from "../../services/jupiter";
// import { internal } from "../../_generated/api";
// import { simulateTransaction } from "../../services/solana";
// import { delay } from "../../utils/retry";
// import { parseTransactionsBalanceChanges } from "../../helpers/parseTransaction";
// import { SwapQuotes } from "../../helpers/normalizeServerSwapQuote";
// const vCollateralToken = v.object({
//   mint: v.string(),
//   decimals: v.number(),
//   amount: v.number(),
// });

// const vPairToken = v.object({
//   mint: v.string(),
//   decimals: v.number(),
//   split: v.number(), // must be between 0-1
// });

// export const createPosition = action({
//   args: {
//     quoteDetails: v.array(vQuoteDetails),
//     poolAddress: v.string(),
//     autoCompoundSplit: v.number(),
//     poolEntryPrice: v.number(),
//     lowerBin: vBinIdAndPrice,
//     upperBin: vBinIdAndPrice,
//     collateral: vCollateralToken,
//     tokenX: vPairToken,
//     tokenY: vPairToken,
//     liquidityShape: vLiquidityShape,
//   },
//   handler: async (ctx, args): Promise<ActionRes<"create_position">> => {
//     try {
//       console.time("Auth");
//       const { user, userWallet } = await authenticateUser({ ctx });
//       if (!user) throw new Error("Unauthorized user");
//       const { tokenX, tokenY, collateral, poolAddress, lowerBin, upperBin, liquidityShape } = args;
//       console.timeEnd("Auth");

//       const collateralRawAmount = amountToRawAmount(collateral.amount, collateral.decimals);
//       const xInCollateralRaw = Math.floor(collateralRawAmount * tokenX.split);
//       const yInCollateralRaw = Math.floor(collateralRawAmount * tokenY.split);
//       console.log("Coll", collateralRawAmount);
//       console.log("x", xInCollateralRaw);
//       console.log("y", yInCollateralRaw);

//       const { swapQuotes, swapSpecs } = await getTitanSwapQuotesOrFallback({
//         quoteDetails: args.quoteDetails,
//         userId: user._id,
//         collateralMint: toAddress(collateral.mint),
//         xMint: toAddress(tokenX.mint),
//         yMint: toAddress(tokenY.mint),
//         xInCollateralRaw,
//         yInCollateralRaw,
//         slippageBps: 100,
//       });

//       console.time("exc swaps");
//       const swapExecuteRes = await executeSwapsWithNozomi({ userWallet, titanSwapQuotes: swapQuotes, swapSpecs });
//       console.timeEnd("exc swaps");

//       if (!swapExecuteRes.ok) {
//         //TODO: Handle partial swaps , maybe add to a db and write down that a user got funds that are partially swapped so if he will retry to create position we will use them and skip the swap, also we will show notification
//         console.error("Error executing swaps with nozomi on create position:", swapExecuteRes.errorMsg);
//         return {
//           status: "failed",
//           errorMsg: swapExecuteRes.errorMsg,
//         };
//       }

//       console.time("Parse");
//       //TODO: set up woth triton key and then we can do batch which should be faster
//       //TODO: Modify getTokenBalanceChangesAcrossTxs so it could return to us statues as we want to know if a swap failed
//       const parseSwapTxsRes = await parseTransactionsBalanceChanges({
//         userAddress: userWallet.address,
//         signatures: swapExecuteRes.txIds,
//         shouldAwaitConfirmation: true,
//       });
//       if (!parseSwapTxsRes.ok) {
//         //TODO: handle partial failure and get good error message, use swapExecuteRes to find the quote of the failed sig
//         console.error("Swaps on create position failed:", parseSwapTxsRes.failedSigs.length, " swaps failed");

//         return {
//           status: "failed",
//           errorMsg: `${parseSwapTxsRes.failedSigs?.length} swaps failed`,
//         };
//       }

//       const { tokenBalancesChange } = parseSwapTxsRes;

//       console.log("Blanac res", tokenBalancesChange);
//       const xDelta = tokenBalancesChange[tokenX.mint]?.rawAmount ?? new BN(0);
//       const yDelta = tokenBalancesChange[tokenY.mint]?.rawAmount ?? new BN(0);

//       const xAmountInFromSwap = BN.max(xDelta, new BN(0));
//       const yAmountInFromSwap = BN.max(yDelta, new BN(0));

//       console.log(xAmountInFromSwap.toString());
//       console.log(yAmountInFromSwap.toString());

//       console.timeEnd("Parse");

//       const xRawAmount = collateral.mint === tokenX.mint ? new BN(xInCollateralRaw) : xAmountInFromSwap;

//       const yRawAmount = collateral.mint === tokenY.mint ? new BN(yInCollateralRaw) : yAmountInFromSwap;

//       console.log(xRawAmount.toString(), yRawAmount.toString());

//       console.time("exc create");
//       const createRes = await buildAndSendCreatePositionWithRetry({
//         userWallet,
//         poolAddress,
//         xRawAmount: xRawAmount,
//         yRawAmount: yRawAmount,
//         strategy: {
//           minBinId: lowerBin.id,
//           maxBinId: upperBin.id,
//           strategyType: StrategyType[liquidityShape],
//         },
//       });

//       if (!createRes?.ok) {
//         console.error("Couldn't build or send create position transaction:", createRes?.error);

//         return {
//           status: "failed",
//           errorMsg: createRes?.error as string,
//         };
//       }
//       const { createPositionTxId, positionPubkey } = createRes;
//       console.timeEnd("exc create");

//       console.time("db");
//       //TODO: Change token prices to get from our mnm-server using switchboard
//       const tokenPrices = await getJupiterTokenPrices({
//         mints: [toAddress(collateral.mint), toAddress(tokenX.mint), toAddress(tokenY.mint)],
//       });

//       const tokenDetails = {
//         collateral: {
//           mint: collateral.mint,
//           rawAmount: collateralRawAmount,
//           usdPrice: tokenPrices[toAddress(collateral.mint)]?.usdPrice ?? 0,
//         },
//         tokenX: {
//           mint: tokenX.mint,
//           rawAmount: safeBigIntToNumber(xRawAmount),
//           usdPrice: tokenPrices[toAddress(tokenX.mint)]?.usdPrice ?? 0,
//         },
//         tokenY: {
//           mint: tokenY.mint,
//           rawAmount: safeBigIntToNumber(yRawAmount),
//           usdPrice: tokenPrices[toAddress(tokenY.mint)]?.usdPrice ?? 0,
//         },
//       };

//       const transactionIds = [
//         ...swapExecuteRes.txIds.map((id, i) => ({ id, description: `Swap ${i + 1}` })),
//         { id: createPositionTxId, description: "Create Position" },
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
//               range: `${lowerBin.price}-${upperBin.price}`,
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
//             poolEntryPrice: args.poolEntryPrice,
//             details: {
//               autoCompoundSplit: args.autoCompoundSplit,
//               lowerBin: lowerBin,
//               upperBin: upperBin,
//               liquidityStrategy: liquidityShape,
//             },
//             ...tokenDetails,
//           },
//         }),
//       ]);
//       console.timeEnd("db");

//       return {
//         status: "success",
//         result: {
//           activityId,
//           positionPubkey,
//           createPositionTxId,
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

// async function buildAndSendCreatePositionWithRetry({
//   userWallet,
//   poolAddress,
//   xRawAmount,
//   yRawAmount,
//   strategy,
//   maxRetry = 4,
// }: {
//   userWallet: PrivyWallet;
//   poolAddress: string;
//   xRawAmount: BN;
//   yRawAmount: BN;
//   strategy: StrategyParameters;
//   maxRetry?: number;
// }) {
//   for (let attempt = 1; attempt <= maxRetry; attempt++) {
//     try {
//       console.log(`Create position attempt ${attempt}/${maxRetry}`);
//       const { blockhash } = await connection.getLatestBlockhash();

//       const { createPositionTx, positionPubkey } = await buildCreatePositionTx({
//         userAddress: userWallet.address,
//         poolAddress,
//         xRawAmount,
//         yRawAmount,
//         strategy,
//         options: { useNozomi: true, recentBlockhash: blockhash },
//       });

//       const sim = await simulateTransaction(createPositionTx);
//       if (sim.err) {
//         if (attempt === maxRetry) {
//           return {
//             ok: false as const,
//             error: "Simulation Error",
//             attempted: maxRetry,
//           };
//         }
//         console.log(sim.logs);
//         console.error("Simulation Failed", sim.err);
//         await delay(700 * attempt);
//         continue;
//       }
//       console.log("Simulation succses");
//       const createPositionTxId = await sendNozomiTransaction({
//         userWallet,
//         versionedTx: createPositionTx,
//       });

//       return {
//         ok: true as const,
//         createPositionTxId,
//         positionPubkey,
//         attempt,
//       };
//     } catch (err) {
//       console.error("Create position failed", err);

//       if (attempt === maxRetry) {
//         return {
//           ok: false as const,
//           error: "Error sending create position transaction with nozomi",
//           attempted: maxRetry,
//         };
//       }
//       await delay(700 * attempt);
//     }
//   }
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
//     useNozomi?: boolean;
//     recentBlockhash?: string;
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

//   const cuIxs: TransactionInstruction[] = getCuInstructions({
//     limit: options?.cuLimit,
//     price: options?.cuPriceMicroLamports,
//   });

//   //remove Meteora's compute limit and use our own .
//   const createPositionIxs = createPositionTx.instructions.filter((ix) => {
//     return !ix.programId.equals(ComputeBudgetProgram.programId);
//   });

//   if (options?.useNozomi) {
//     const tipIxn = SystemProgram.transfer({
//       fromPubkey: new PublicKey(userAddress),
//       toPubkey: new PublicKey(getRandomNozomiTipPubkey()),
//       lamports: 1_050_000,
//     });
//     createPositionIxs.push(tipIxn);
//   }

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

// export async function getTitanSwapQuotesOrFallback({
//   quoteDetails,
//   userId,
//   collateralMint,
//   xMint,
//   yMint,
//   xInCollateralRaw,
//   yInCollateralRaw,
//   slippageBps,
// }: {
//   quoteDetails: any[];
//   userId: string;
//   collateralMint: Address;
//   xMint: Address;
//   yMint: Address;
//   xInCollateralRaw: number;
//   yInCollateralRaw: number;
//   slippageBps: number;
// }): Promise<{
//   swapQuotes: SwapQuotes[] | undefined;
//   swapSpecs: SwapSpec[];
// }> {
//   let swapQuotes: any[] | undefined = undefined;
//   let swapSpecs: SwapSpec[] = [];

//   try {
//     console.time("TitanQuote");

//     swapQuotes = await Promise.all(quoteDetails.map((q) => getServerSwapQuote({ userId, ...q })));

//     console.timeEnd("TitanQuote");

//     // Validate Titan responses

//     // 1. length mismatch
//     if (!swapQuotes || swapQuotes.length !== quoteDetails.length) {
//       throw new Error("Titan returned incomplete results");
//     }

//     // 2. empty or missing routes
//     const emptyRoutes = swapQuotes.some((q) => !q.quotes || Object.keys(q.quotes).length === 0);

//     if (emptyRoutes) {
//       throw new Error("Titan returned empty routes");
//     }
//   } catch (err) {
//     console.error("Titan quote failure - falling back to Jupiter:", err);

//     swapQuotes = undefined;

//     // Build fallback specs
//     swapSpecs = buildFallbackSwapSpecs({
//       collateralMint,
//       xMint,
//       yMint,
//       xInCollateralRaw,
//       yInCollateralRaw,
//       slippageBps,
//     });
//   }

//   return { swapQuotes, swapSpecs };
// }

// // ---- Fallback Spec Builder ----

// export function buildFallbackSwapSpecs({
//   collateralMint,
//   xMint,
//   yMint,
//   xInCollateralRaw,
//   yInCollateralRaw,
//   slippageBps,
// }: {
//   collateralMint: Address;
//   xMint: Address;
//   yMint: Address;
//   xInCollateralRaw: number;
//   yInCollateralRaw: number;
//   slippageBps: number;
// }): SwapSpec[] {
//   const specs: SwapSpec[] = [];

//   if (collateralMint !== xMint) {
//     specs.push({
//       inputMint: collateralMint,
//       outputMint: xMint,
//       amount: new BN(xInCollateralRaw),
//       slippageBps,
//     });
//   }

//   if (collateralMint !== yMint) {
//     specs.push({
//       inputMint: collateralMint,
//       outputMint: yMint,
//       amount: new BN(yInCollateralRaw),
//       slippageBps,
//     });
//   }

//   return specs;
// }
