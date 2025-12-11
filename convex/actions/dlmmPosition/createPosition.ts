"use node";
import { Infer, v } from "convex/values";
import { StrategyParameters, StrategyType } from "@meteora-ag/dlmm";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
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
import {
  Address,
  buildWrapSolInstructions,
  fastTransactionConfirm,
  getCuInstructions,
  getMarketFromMints,
  mints,
  toAddress,
  tokensMetadata,
  toVersioned,
} from "../../utils/solana";
import { api, internal } from "../../_generated/api";
import { getDlmmPoolConn } from "../../services/meteora";
import { vLimitOrderInput } from "../../schema/limitOrders";
import { buildMultipleJupiterSwapsAtomically, SwapSpec } from "../../helpers/executeSwapsWithNozomi";
import { tryCatch } from "../../utils/tryCatch";
import { deriveLoanPda } from "../../utils/loopscale";
import { deriveMeteoraPositionPubkey } from "../../utils/meteora";
import { flashBorrow } from "../../services/loopscale";

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

export const vLoopscaleQuote = v.object({
  leverage: v.number(),
  cBpsApy: v.number(),
  cBpsLqt: v.number(),
  strategy: v.string(),
});
export const createPosition = action({
  args: {
    quoteDetails: v.array(vQuoteDetails),
    poolAddress: v.string(),
    autoCompoundSplit: v.number(),
    poolEntryPrice: v.number(),
    activeBin: vBinIdAndPrice,
    lowerBin: vBinIdAndPrice,
    upperBin: vBinIdAndPrice,
    collateral: vCollateralToken,
    tokenX: vPairToken,
    tokenY: vPairToken,
    liquidityShape: vLiquidityShape,
    borrowQuote: v.optional(vLoopscaleQuote),
    limits: v.optional(v.object({ sl: v.optional(vLimitOrderInput), tp: v.optional(vLimitOrderInput) })),
  },
  handler: async (ctx, args): Promise<ActionRes<"create_position">> => {
    try {
      const { user, userWallet } = await authenticateUser({ ctx });
      const { tokenX, tokenY, collateral, poolAddress, activeBin, lowerBin, upperBin, liquidityShape } = args;

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
              skipCloseAccount: true,
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
          skipCloseAccount: true,
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

      let positionPubkey: Address;
      let loanAddress: Address | undefined;
      let loopscaleBlockHash: string | null = null;
      const createPositionTransactions: VersionedTransaction[] = [];
      const isLeverage = args.borrowQuote && args.borrowQuote.leverage > 1;
      if (isLeverage && args.borrowQuote) {
        const { wrapSolTx } = buildWrapSolTx({
          userAddress: toAddress(userWallet.address),
          xMint: toAddress(tokenX.mint),
          yMint: toAddress(tokenY.mint),
          xRawAmount: safeBigIntToNumber(xRawAmount),
          yRawAmount: safeBigIntToNumber(yRawAmount),
          options: { cuLimit, cuPriceMicroLamports, recentBlockhash: blockhash },
        });

        const {
          createLeveragedPositionTx,
          positionPubkey: pk,
          loanAddress: loan,
        } = await buildLeveragedCreatePositionTx({
          userAddress: toAddress(userWallet.address),
          poolAddress: toAddress(poolAddress),
          activeBinId: activeBin.id,
          lowerBinId: lowerBin.id,
          upperBinId: upperBin.id,
          collateralMint: toAddress(collateral.mint),
          collateralRawAmount,
          liquidityShape,
          xRawAmount,
          yRawAmount,
          borrowQuote: args.borrowQuote,
        });

        positionPubkey = pk;
        loanAddress = toAddress(loan);
        if (wrapSolTx) createPositionTransactions.push(wrapSolTx);
        createPositionTransactions.push(createLeveragedPositionTx[0]);
        loopscaleBlockHash = createLeveragedPositionTx[0].message.recentBlockhash;
      } else {
        const { createPositionTx, positionPubkey: pk } = await buildCreatePositionTx({
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

        positionPubkey = toAddress(pk);
        createPositionTransactions.push(createPositionTx);
      }

      //TODO: Change token prices to get from our mnm-server using switchboard
      const getTokenPrices = getJupiterTokenPrices({
        mints: [toAddress(collateral.mint), toAddress(tokenX.mint), toAddress(tokenY.mint)],
      });

      const sendBundle = signAndSendJitoBundle({
        userWallet,
        overwriteBlockHash: loopscaleBlockHash ? loopscaleBlockHash : blockhash,
        transactions: [...swapsTxs, ...createPositionTransactions, tipTx],
      });

      const [{ txIds, bundleId }, tokenPrices] = await Promise.all([sendBundle, getTokenPrices]);
      const createPositionTxId = txIds[txIds.length - 2];
      const txsConfirmRes = await fastTransactionConfirm([createPositionTxId], 10_000);
      console.log("bundleId", bundleId);
      if (txsConfirmRes[0].err) {
        throw new Error(
          `Transaction ${txsConfirmRes[0].signature} failed: ${JSON.stringify(txsConfirmRes[0].err ?? "couldn't confirm the transaction")}`
        );
      }
      console.time("db");

      //TODO: Make it more accurate with simulations on the create leverage position
      const leverage = args.borrowQuote?.leverage ?? 1;
      const xInitialSize = isLeverage ? safeBigIntToNumber(xRawAmount) * leverage : safeBigIntToNumber(xRawAmount);

      const yInitialSize = isLeverage ? safeBigIntToNumber(yRawAmount) * leverage : safeBigIntToNumber(yRawAmount);
      const tokenDetails = {
        collateral: {
          mint: collateral.mint,
          rawAmount: collateralRawAmount,
          usdPrice: tokenPrices[toAddress(collateral.mint)]?.usdPrice ?? 0,
        },
        tokenX: {
          mint: tokenX.mint,
          rawAmount: xInitialSize,
          usdPrice: tokenPrices[toAddress(tokenX.mint)]?.usdPrice ?? 0,
        },
        tokenY: {
          mint: tokenY.mint,
          rawAmount: yInitialSize,
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
              //TODO: add borrowed amounts
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
            leverage: args.borrowQuote?.leverage ?? 1,
            loanAddress,
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

async function buildLeveragedCreatePositionTx({
  userAddress,
  poolAddress,
  lowerBinId,
  upperBinId,
  collateralRawAmount,
  collateralMint,
  activeBinId,
  xRawAmount,
  yRawAmount,
  liquidityShape,
  borrowQuote,
}: {
  userAddress: Address;
  poolAddress: Address;
  activeBinId: number;
  lowerBinId: number;
  upperBinId: number;
  collateralMint: Address;
  collateralRawAmount: number;
  xRawAmount: BN;
  yRawAmount: BN;
  liquidityShape: Infer<typeof vLiquidityShape>;
  borrowQuote: Infer<typeof vLoopscaleQuote>;
}) {
  const { brwRawAmountInCollateral, xBorrowedRaw, yBorrowedRaw } = calculateBorrowedAmount({
    collateralMint,
    collateralRawAmount,
    leverage: borrowQuote.leverage,
    xRawAmount,
    yRawAmount,
  });
  const loanPda = deriveLoanPda({ userAddress });
  const positionPda = toAddress(
    deriveMeteoraPositionPubkey({ poolAddress, loanPda, lowerBinId, upperBinId }).toBase58()
  );

  const { transactions, loanAddress } = await flashBorrow({
    collateralBorrowedRawAmount: safeBigIntToNumber(brwRawAmountInCollateral),
    positionPda,
    lowerBinId,
    upperBinId,
    liquidityShape,
    xRawAmount: safeBigIntToNumber(xBorrowedRaw.add(xRawAmount)),
    yRawAmount: safeBigIntToNumber(yBorrowedRaw.add(yRawAmount)),
    activeBinId,
    userAddress,
    collateralMint,
    poolAddress,
    borrowQuote,
  });

  const versionedTxs = transactions.map((tx) => {
    const rawMsg = Buffer.from(tx.message, "base64");
    const msg = VersionedMessage.deserialize(rawMsg);

    // msg.recentBlockhash = blockhash;

    const vtx = new VersionedTransaction(msg);

    // allocate correct number of signature slots
    vtx.signatures = Array(msg.header.numRequiredSignatures).fill(Buffer.alloc(64)); // empty sig

    // now apply program signatures
    for (const s of tx.signatures) {
      const pk = new PublicKey(s.publicKey);
      const idx = msg.staticAccountKeys.findIndex((k) => k.equals(pk));

      if (idx === -1) throw new Error("Signature pubkey not in account list");

      vtx.signatures[idx] = Buffer.from(s.signature, "base64");
    }

    return vtx;
  });

  const positionPubkey = toAddress(
    deriveMeteoraPositionPubkey({ poolAddress, loanPda: new PublicKey(loanAddress), lowerBinId, upperBinId }).toBase58()
  );

  console.log("Position Pubkey", positionPubkey);

  return { createLeveragedPositionTx: versionedTxs, loanAddress, positionPubkey };
}

function calculateBorrowedAmount({
  collateralMint,
  collateralRawAmount,
  xRawAmount,
  yRawAmount,
  leverage,
}: {
  collateralMint: Address;
  collateralRawAmount: number;
  xRawAmount: BN;
  yRawAmount: BN;
  leverage: number;
}) {
  const collateralDecimals = tokensMetadata[collateralMint].decimals;
  if (!collateralDecimals) throw new Error("Unsupported collateral");

  const SCALE = new BN(1_000_000);
  const total = xRawAmount.add(yRawAmount);

  const xRatio = total.isZero() ? new BN(0) : xRawAmount.mul(SCALE).div(total);
  const borrowedRawBN = new BN(Math.floor(collateralRawAmount * (leverage - 1)));

  const xBorrowedRaw = borrowedRawBN.mul(xRatio).div(SCALE);
  const yBorrowedRaw = borrowedRawBN.sub(xBorrowedRaw);

  return {
    brwRawAmountInCollateral: borrowedRawBN,
    xBorrowedRaw,
    yBorrowedRaw,
  };
}

function buildWrapSolTx({
  userAddress,
  xMint,
  xRawAmount,
  yMint,
  yRawAmount,
  options,
}: {
  userAddress: Address;
  xMint: Address;
  yMint: Address;
  xRawAmount: number; // lamports
  yRawAmount: number; // lamports
  options: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    recentBlockhash: string;
  };
}) {
  const userPubkey = new PublicKey(userAddress);

  let lamportsToWrap = 0;

  if (xMint === mints.sol && xRawAmount > 0) {
    lamportsToWrap = xRawAmount;
  } else if (yMint === mints.sol && yRawAmount > 0) {
    lamportsToWrap = yRawAmount;
  }

  if (lamportsToWrap === 0) {
    return { wrapSolTx: null };
  }

  const { instructions } = buildWrapSolInstructions({
    userAddress,
    lamports: lamportsToWrap,
  });

  const cuIxs = getCuInstructions({ limit: options.cuLimit, price: options.cuPriceMicroLamports });

  const legacyTx = new Transaction().add(...cuIxs).add(...instructions);
  legacyTx.recentBlockhash = options.recentBlockhash;
  legacyTx.feePayer = userPubkey;

  const wrapSolTx = toVersioned(legacyTx);

  return { wrapSolTx };
}
