"use node";
import { v } from "convex/values";
import {
  authenticateUser,
  CHAIN_ID_MAINNET,
  privy,
  privyAuthContext,
} from "../../privy";
import { ActionRes } from "../../types/actionResults";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getDlmmPoolConn } from "../../services/meteora";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Address,
  fastTransactionConfirm,
  getCuInstructions,
  toAddress,
  toVersioned,
} from "../../utils/solana";
import { buildTipTx, signAndSendJitoBundle } from "../../helpers/jito";
import { connection } from "../../convexEnv";
import DLMM, { LbPosition } from "@meteora-ag/dlmm";
import { simulateAndGetTokensBalance } from "../../helpers/simulateAndGetTokensBalance";
import BN from "bn.js";
import { SwapSpec } from "../../helpers/executeSwapsWithNozomi";
import { buildJupSwapTransaction } from "../../helpers/buildJupiterSwapTransaction";
import { safeBigIntToNumber } from "../../utils/amounts";
import { tryCatch } from "../../utils/tryCatch";
import {
  getJupiterTokenPrices,
  JupQuoteResponse,
} from "../../services/jupiter";
import { buildTransferMnMTx } from "../../helpers/transferMnMFees";
import { loopscaleClaimDlmmFees } from "../../services/loopscale";

export const claimFees = action({
  args: {
    positionPubkey: v.string(),
    isAutomated: v.boolean(),
  },
  handler: async (ctx, args): Promise<ActionRes<"claim_fees">> => {
    try {
      console.log("Start cliam fee convex");
      const { positionPubkey, isAutomated } = args;
      const { user, userWallet } = await authenticateUser({ ctx });
      if (!user || !userWallet) throw new Error("Couldn't find user");
      const position = await ctx.runQuery(
        api.tables.positions.get.getPositionByPubkey,
        { positionPubkey },
      );
      if (!position) throw new Error(`Position ${positionPubkey} not found`);

      const dlmmPoolConn = await getDlmmPoolConn(position.poolAddress);
      const onChainPosition = await dlmmPoolConn.getPosition(
        new PublicKey(positionPubkey),
      );

      const userAddress = toAddress(userWallet.address);
      const xMint = toAddress(position.tokenX.mint);
      const yMint = toAddress(position.tokenY.mint);
      const outputMint = toAddress(position.collateral.mint);

      const { claimTx, xClaimed, yClaimed } = await buildAndSimulateClaimFeeTx({
        userAddress,
        dlmmPoolConn,
        onChainPosition,
        loanAddress: position.loanAddress
          ? toAddress(position.loanAddress)
          : undefined,
        options: {
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        },
      });

      const { hash } = await privy
        .wallets()
        .solana()
        .signAndSendTransaction(userWallet.id ?? "", {
          caip2: CHAIN_ID_MAINNET,
          transaction: claimTx.serialize(),
          authorization_context: privyAuthContext,
        });

      try {
        await fastTransactionConfirm([hash], 10_000);
      } catch (error) {
        return {
          status: "failed",
          errorMsg: "Transaction failed",
        };
      }
      const { blockhash } = await connection.getLatestBlockhash();
      const { tipTx } = await buildTipTx({
        speed: "low",
        payerAddress: userWallet.address,
        recentBlockhash: blockhash,
      });

      const swapSpecs: SwapSpec[] = [
        { inputMint: xMint, outputMint, amount: xClaimed, slippageBps: 150 },
        { inputMint: yMint, outputMint, amount: yClaimed, slippageBps: 150 },
      ];

      const buildSwaps = swapSpecs
        .filter(
          ({ inputMint, amount }) =>
            !amount.isZero() && inputMint !== outputMint,
        )
        .map(async ({ inputMint, amount, slippageBps }) => {
          return buildJupSwapTransaction({
            userAddress,
            inputMint,
            inputAmount: safeBigIntToNumber(
              amount.muln(0.2),
              `Swap ${inputMint}`,
            ),
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

      const transactions: { tx: VersionedTransaction; description: string }[] =
        [
          // {
          //   tx: toVersioned(claimTx),
          //   description: "Claim Fees",
          // },
          ...swapsRes.data.map(({ tx }, i) => ({
            tx,
            description: `Swap #${i + 1}`,
          })),
        ];

      let directOutput = new BN(0); //when no swap is needed
      if (xMint === outputMint) directOutput = directOutput.add(xClaimed);
      if (yMint === outputMint) directOutput = directOutput.add(yClaimed);
      const swappedOut = computeTotalClaimedFeesInOutputTokenFromSwaps({
        swapQuotes: swapsRes.data.map((s) => s.quote),
      }).totalFeesClaimedInOutputToken;

      const totalFeesInRawOutputToken = swappedOut.add(directOutput);
      let userRawOutput = safeBigIntToNumber(
        totalFeesInRawOutputToken,
        "userRawOutput",
      );

      const mnmFeeClaimTxRes = await buildTransferMnMTx({
        userWallet,
        outputMint,
        totalFeesInRawOutputToken,
      });

      if (mnmFeeClaimTxRes) {
        transactions.push({
          tx: toVersioned(mnmFeeClaimTxRes.mnmFeeClaimTx),
          description: "MnM Fee",
        });
        userRawOutput = userRawOutput - mnmFeeClaimTxRes.mnmFeeRawAmount;
      }

      transactions.push({ tx: tipTx, description: "Jito Tip" });

      const { txIds, bundleId } = await signAndSendJitoBundle({
        userWallet,
        transactions: transactions.map((tx) => tx.tx),
      });

      const txsConfirmRes = await fastTransactionConfirm([txIds[0]], 7_000);
      if (txsConfirmRes[0].err) {
        throw new Error(
          `Transaction ${txsConfirmRes[0].signature} failed: ${JSON.stringify(txsConfirmRes[0].err)}`,
        );
      }

      const prices = await getJupiterTokenPrices({
        mints: [xMint, yMint, outputMint],
      });
      const xPrice = prices[xMint]?.usdPrice ?? 0;
      const yPrice = prices[yMint]?.usdPrice ?? 0;
      const outputPrice = prices[outputMint]?.usdPrice ?? 0;

      const transactionIds = transactions.map(({ description }, i) => {
        return {
          id: txIds[i],
          description,
        };
      });

      const activityId = await ctx.runMutation(
        internal.tables.activities.mutations.createActivity,
        {
          userId: user._id,
          input: {
            type: "claim_fees",
            relatedPositionPubkey: positionPubkey,
            transactionIds: [
              { id: hash, description: "Claim Fee" },
              ...transactionIds,
            ],
            bundleId,
            details: {
              autoTriggered: isAutomated,
              compoundedRawAmounts: { tokenX: 0, tokenY: 0 },
              poolAddress: position.poolAddress,
              positionType: "DLMM",
              harvested: {
                mint: outputMint,
                rawAmount: userRawOutput,
                usdPrice: outputPrice,
              },
              claimedX: {
                mint: position.tokenX.mint,
                rawAmount: safeBigIntToNumber(xClaimed, "X claimed"),
                usdPrice: xPrice,
              },
              claimedY: {
                mint: position.tokenY.mint,
                rawAmount: safeBigIntToNumber(yClaimed, "Y claimed"),
                usdPrice: yPrice,
              },
            },
          },
        },
      );

      return {
        status: "success",
        result: { activityId, claimFeeTxId: hash },
      };
    } catch (error: any) {
      console.error("Claim fees failed:", error);
      return {
        status: "failed",
        errorMsg: error.message ?? "Something went wrong while claiming fees.",
      };
    }
  },
});

async function buildAndSimulateClaimFeeTx({
  userAddress,
  dlmmPoolConn,
  onChainPosition,
  loanAddress,
  options,
}: {
  userAddress: string;
  dlmmPoolConn: DLMM;
  onChainPosition: LbPosition;
  loanAddress?: Address;
  options: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    recentBlockhash: string;
  };
}) {
  // //note: multiple tx only when there is more then 69 bins.

  let tx: VersionedTransaction;
  if (loanAddress) {
    tx = await buildLoopscaleClaimFeeTx({
      userAddress: toAddress(userAddress),
      loanAddress,
      positionPubkey: toAddress(onChainPosition.publicKey.toBase58()),
    });
  } else {
    const claimFeeTx = (
      await dlmmPoolConn.claimSwapFee({
        owner: new PublicKey(userAddress),
        position: onChainPosition,
      })
    )[0];

    if (!claimFeeTx) {
      throw new Error("No fees to claim");
    }
    const cuIxs: TransactionInstruction[] = getCuInstructions({
      limit: options?.cuLimit,
      price: options?.cuPriceMicroLamports,
    });

    //remove Meteora's compute limit and use our own .
    const filteredIxs = claimFeeTx.instructions.filter((ix) => {
      return !ix.programId.equals(ComputeBudgetProgram.programId);
    });

    const message = new TransactionMessage({
      payerKey: new PublicKey(userAddress),
      recentBlockhash:
        options?.recentBlockhash ??
        (await connection.getLatestBlockhash()).blockhash,
      instructions: [...cuIxs, ...filteredIxs],
    }).compileToV0Message();

    tx = new VersionedTransaction(message);
  }

  const simRes = await simulateAndGetTokensBalance({
    userAddress: toAddress(dlmmPoolConn.pubkey.toBase58()),
    transaction: tx,
  });

  if (simRes.sim.err) {
    throw new Error("Failed to simulate claim fees transaction");
  }

  const xMint = dlmmPoolConn.lbPair.tokenXMint.toBase58();
  const yMint = dlmmPoolConn.lbPair.tokenYMint.toBase58();
  console.log("t", simRes.tokenBalancesChange);
  console.log(
    "x claimed",
    simRes.tokenBalancesChange[xMint].rawAmount.toString(),
  );
  console.log(
    "y claimed",
    simRes.tokenBalancesChange[yMint].rawAmount.toString(),
  );
  const xDelta = simRes.tokenBalancesChange[xMint]?.rawAmount ?? new BN(0);
  const yDelta = simRes.tokenBalancesChange[yMint]?.rawAmount ?? new BN(0);
  //we checking how much tokens getting out of the pool
  const xClaimed = xDelta.isNeg() ? xDelta.abs() : new BN(0);
  const yClaimed = yDelta.isNeg() ? yDelta.abs() : new BN(0);

  if (xClaimed.isZero() && yClaimed.isZero())
    throw new Error("No fees to claim");

  return {
    claimTx: tx,
    xClaimed,
    yClaimed,
  };
}

function computeTotalClaimedFeesInOutputTokenFromSwaps({
  swapQuotes,
}: {
  swapQuotes: JupQuoteResponse[];
}) {
  const totalOut = swapQuotes.reduce((acc, q) => {
    return acc.add(new BN(q.outAmount));
  }, new BN(0));

  return {
    totalFeesClaimedInOutputToken: totalOut,
  };
}

async function buildLoopscaleClaimFeeTx({
  userAddress,
  loanAddress,
  positionPubkey,
}: {
  userAddress: Address;
  loanAddress: Address;
  positionPubkey: Address;
}) {
  const { message, signatures } = await loopscaleClaimDlmmFees({
    userAddress,
    loanAddress,
    positionPubkey,
  });

  const rawMsg = Buffer.from(message, "base64");
  const msg = VersionedMessage.deserialize(rawMsg);
  const vtx = new VersionedTransaction(msg);

  // allocate correct number of signature slots
  vtx.signatures = Array(msg.header.numRequiredSignatures).fill(
    Buffer.alloc(64),
  ); // empty sig

  // now apply program signatures
  for (const s of signatures) {
    const pk = new PublicKey(s.publicKey);
    const idx = msg.staticAccountKeys.findIndex((k) => k.equals(pk));

    if (idx === -1) throw new Error("Signature pubkey not in account list");

    vtx.signatures[idx] = Buffer.from(s.signature, "base64");
  }

  return vtx;
}
