import BN from "bn.js";
import { BlockhashWithExpiryBlockHeight, VersionedTransaction } from "@solana/web3.js";
import { PrivyWallet } from "../privy";
import { Address, toAddress } from "../utils/solana";
import { JupQuoteResponse } from "../services/jupiter";
import { buildAndSimulateJupiterSwap } from "./buildJupiterSwapTransaction";
import { safeBigIntToNumber } from "../utils/amounts";
import { sendNozomiTransaction } from "./nozomi";
import { connection } from "../convexEnv";
import { SwapQuotes } from "./normalizeServerSwapQuote";
import { buildTitanSwapTransaction } from "./buildTitanSwapTransaction";
import { simulateAndGetTokensBalance } from "./simulateAndGetTokensBalance";

export async function executeSwapsWithNozomi({
  userWallet,
  swapSpecs,
  titanSwapQuotes,
  accumulatedSuccess = [],
  maxRetry = 3,
  attempt = 1,
}: {
  userWallet: PrivyWallet;
  swapSpecs: SwapSpec[];
  titanSwapQuotes?: SwapQuotes[];
  accumulatedSuccess?: NozomiSwapSuccess[];
  maxRetry?: number;
  attempt?: number;
}) {
  console.log(`⚡ Execute swaps attempt ${attempt}/${maxRetry}`);

  let swapDetails: SwapDetail[] = [];
  const blockhash = await connection.getLatestBlockhash();
  // 1. Build swapDetails either from Titan quotes or Jupiter atomic builder
  if (titanSwapQuotes && titanSwapQuotes.length > 0) {
    try {
      swapDetails = await buildTitanSwaps({ userWallet, titanSwapQuotes, blockhash });
    } catch (error) {
      console.error("Titan swap build failed, falling back to Jupiter swaps:", error);

      // Option A: fall back to Jupiter using Titan quote amounts as base specs
      const newSwapSpecs = titanSwapQuotes.map(titanQuoteToSwapSpec);

      return await executeSwapsWithNozomi({
        userWallet,
        swapSpecs: newSwapSpecs,
        accumulatedSuccess: [],
        maxRetry,
        attempt: attempt + 1,
      });
    }
  } else {
    const build = await buildMultipleJupiterSwapsAtomically({
      userAddress: userWallet.address,
      swapSpecs,
      useNozomi: true,
      blockhash: blockhash.blockhash,
    });

    if (!build.ok) {
      return {
        ok: false as const,
        failedAt: "build" as const,
        errorMsg: build.errorMsg,
        errorData: build.errorData,
        attempt,
      };
    }

    swapDetails = build.swapDetails.map(
      (d): SwapDetail => ({
        tx: d.tx,
        quote: {
          inputMint: d.quote.inputMint,
          inAmount: Number(d.quote.inAmount),
          outputMint: d.quote.outputMint,
          outAmount: Number(d.quote.outAmount),
          slippageBps: d.quote.slippageBps,
          priceImpactPct: "0",
        },
      })
    );
  }

  // 2. Send swaps via Nozomi
  const sendResults = await Promise.all(
    swapDetails.map(({ tx, quote }) => sendSwap({ userWallet, tx, quote, attempt }))
  );

  const succeeded = sendResults.filter((r): r is SwapSendSuccess => r.ok);
  const failed = sendResults.filter((r): r is SwapSendFailure => !r.ok);

  const newAccumulatedSuccess: NozomiSwapSuccess[] = [
    ...accumulatedSuccess,
    ...succeeded.map(({ txId, quote }) => ({
      txId,
      quote: normalizeQuote(quote),
    })),
  ];

  // 3. All succeeded
  if (failed.length === 0) {
    return successResponse(newAccumulatedSuccess, attempt);
  }

  // 4. Out of retries
  if (attempt >= maxRetry) {
    return failureResponse(failed, newAccumulatedSuccess, attempt);
  }

  // 5. Retry only failed swaps (re-quote + rebuild path)
  const retrySpecs = failed.map((f) => quoteToSwapSpec(f.quote));

  return await executeSwapsWithNozomi({
    userWallet,
    swapSpecs: retrySpecs,
    titanSwapQuotes: undefined,
    accumulatedSuccess: newAccumulatedSuccess,
    maxRetry,
    attempt: attempt + 1,
  });
}

// ----------------- Jupiter atomic builder -----------------

type SwapAtomicSuccess = {
  ok: true;
  swapDetails: { tx: VersionedTransaction; quote: JupQuoteResponse }[];
};

type SwapAtomicError = {
  ok: false;
  errorMsg: string;
  errorData?: any;
};

type SwapAtomicResult = SwapAtomicSuccess | SwapAtomicError;

export async function buildMultipleJupiterSwapsAtomically({
  userAddress,
  swapSpecs,
  blockhash,
  skipCloseAccount = false,
}: {
  userAddress: string;
  swapSpecs: SwapSpec[];
  blockhash: string;
  skipCloseAccount?: boolean;
  useNozomi?: boolean;
}): Promise<SwapAtomicResult> {
  const MAX_TRIES = 7;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    console.log(`Swap atomic build attempt ${attempt}/${MAX_TRIES}`);

    const buildPromises = swapSpecs
      .filter(({ inputMint, outputMint, amount }) => !amount.isZero() && inputMint !== outputMint)
      .map(({ inputMint, outputMint, amount, slippageBps }) =>
        buildAndSimulateJupiterSwap({
          userAddress: toAddress(userAddress),
          inputMint,
          outputMint,
          inputAmount: safeBigIntToNumber(amount, `swap ${inputMint}`),
          slippageBps,
          blockhash,
          useNozomi: true,
          skipCloseAccount,
          options: {
            skipUserAccountsRpcCalls: false,
          },
        })
      );

    const results = await Promise.allSettled(buildPromises);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof buildAndSimulateJupiterSwap>>> =>
        r.status === "fulfilled"
    );

    const failedBuilds = fulfilled.filter((r) => !r.value.ok);
    const rejected = results.filter((r) => r.status === "rejected");

    if (failedBuilds.length > 0 || rejected.length > 0) {
      if (attempt === MAX_TRIES) {
        const err = failedBuilds[0]?.value ??
          rejected[0]?.reason ?? {
            errorMessage: "Unknown swap build error",
          };

        return {
          ok: false,
          errorMsg: err.errorMessage ?? "Unknown swap build error",
          errorData: err,
        };
      }

      continue;
    }

    const swaps = fulfilled
      .map((r) => {
        const v = r.value;
        if (!v.ok) return null;
        return {
          tx: v.tx,
          quote: v.quote as JupQuoteResponse,
        };
      })
      .filter((x): x is { tx: VersionedTransaction; quote: JupQuoteResponse } => x !== null);

    return { ok: true, swapDetails: swaps };
  }

  return { ok: false, errorMsg: "Unexpected error in atomic swap builder" };
}

// ----------------- Titan builder -----------------

async function buildTitanSwaps({
  userWallet,
  titanSwapQuotes,
  blockhash,
}: {
  userWallet: PrivyWallet;
  titanSwapQuotes: SwapQuotes[];
  blockhash: BlockhashWithExpiryBlockHeight;
}): Promise<SwapDetail[]> {
  const { blockhash: recentBlockhash, lastValidBlockHeight } = blockhash;

  return await Promise.all(
    titanSwapQuotes.map(async (q): Promise<SwapDetail> => {
      const route = Object.values(q.quotes)[0];

      if (!route) {
        throw new Error("Titan route missing for swap");
      }

      if (route.expiresAtMs && Date.now() > route.expiresAtMs) {
        throw new Error("Titan quote expired");
      }

      if (route.expiresAfterSlot && lastValidBlockHeight > route.expiresAfterSlot) {
        throw new Error("Titan quote slot-expired");
      }

      const tx = await buildTitanSwapTransaction({
        userAddress: userWallet.address,
        instructions: route.instructions,
        lookupTables: route.addressLookupTables,
        options: {
          cuLimit: 1_200_000,
          cuPriceMicroLamports: 1_200_000,
          recentBlockhash,
          useNozomi: true,
        },
      });

      const simRes = await simulateAndGetTokensBalance({ userAddress: toAddress(userWallet.address), transaction: tx });

      if (simRes.sim.err) {
        console.log("Swap with titan failed", simRes.sim.logs);
        throw new Error("Swap with titan failed", simRes.sim.err);
      }
      console.log("simRes", simRes.tokenBalancesChange[q.outputMint]);
      console.log("Quote a", route.outAmount);

      console.log("After slip", route.outAmount * (1 - route.slippageBps / 10_000));
      return {
        tx,
        quote: {
          inputMint: q.inputMint,
          inAmount: route.inAmount,
          outputMint: q.outputMint,
          outAmount: route.outAmount,
          slippageBps: route.slippageBps,
          priceImpactPct: "0",
        },
      };
    })
  );
}

//Helpers and types

export type NozomiExecutedSwapQuote = {
  inputMint: string;
  inAmount: number;
  outputMint: string;
  outAmount: number;
  slippageBps: number;
  priceImpactPct: string;
};

export type SwapSpec = {
  inputMint: Address;
  outputMint: Address;
  amount: BN;
  slippageBps: number;
};
interface SwapDetail {
  tx: VersionedTransaction;
  quote: NozomiExecutedSwapQuote;
}

type NozomiSwapSuccess = { txId: string; quote: NozomiExecutedSwapQuote };

type SwapSendSuccess = {
  ok: true;
  txId: string;
  quote: NozomiExecutedSwapQuote;
};

type SwapSendFailure = {
  ok: false;
  error: unknown;
  quote: NozomiExecutedSwapQuote;
};

type SwapSendResult = SwapSendSuccess | SwapSendFailure;

// ----------------- Small helpers -----------------

const quoteToSwapSpec = (quote: NozomiExecutedSwapQuote): SwapSpec => ({
  inputMint: toAddress(quote.inputMint),
  outputMint: toAddress(quote.outputMint),
  amount: new BN(quote.inAmount),
  slippageBps: quote.slippageBps,
});

const titanQuoteToSwapSpec = (q: SwapQuotes): SwapSpec => {
  const route = Object.values(q.quotes)[0];

  if (!route) {
    throw new Error("Titan route missing for swap");
  }

  return {
    inputMint: toAddress(q.inputMint),
    outputMint: toAddress(q.outputMint),
    amount: new BN(route.inAmount),
    slippageBps: route.slippageBps,
  };
};

const normalizeQuote = (q: NozomiExecutedSwapQuote): NozomiExecutedSwapQuote => ({
  inputMint: q.inputMint,
  inAmount: Number(q.inAmount),
  outputMint: q.outputMint,
  outAmount: Number(q.outAmount),
  slippageBps: q.slippageBps,
  priceImpactPct: q.priceImpactPct,
});

function successResponse(successes: NozomiSwapSuccess[], attempt: number) {
  return {
    ok: true as const,
    attempt,
    txIds: successes.map((s) => s.txId),
    quotes: successes.map((s) => s.quote),
  };
}

function failureResponse(failed: SwapSendFailure[], successes: NozomiSwapSuccess[], attempt: number) {
  const lastError = failed[failed.length - 1]?.error ?? "Unknown last error";

  return {
    ok: false as const,
    failedAt: "send" as const,
    attempt,
    failedSwaps: failed,
    successfulSwaps: successes,
    errorMsg: extractErrorMessage(lastError),
    lastError,
  };
}

function extractErrorMessage(err: any): string {
  if (!err) return "Unknown error";

  if (typeof err === "string") return err;

  if (err.message) return err.message;

  if (err.errorMessage) return err.errorMessage;

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
async function sendSwap({
  userWallet,
  tx,
  quote,
  attempt,
}: {
  userWallet: PrivyWallet;
  tx: VersionedTransaction;
  quote: NozomiExecutedSwapQuote;
  attempt: number;
}): Promise<SwapSendResult> {
  try {
    const txId = await sendNozomiTransaction({
      userWallet,
      versionedTx: tx,
    });

    return { ok: true, txId, quote };
  } catch (err) {
    console.error(`ERROR sending swap via Nozomi for ${quote.inputMint} on attempt ${attempt}`, err);
    return { ok: false, error: err, quote };
  }
}
