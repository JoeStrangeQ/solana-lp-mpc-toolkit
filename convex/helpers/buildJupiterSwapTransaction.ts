import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getJupSwapInstructions, getJupSwapQuote, JupQuoteResponse } from "../services/jupiter";
import { Address, getCuInstructions, isTokenClose } from "../utils/solana";
import { connection } from "../convexEnv";
import { tryCatch } from "../utils/tryCatch";
import { getRandomNozomiTipPubkey } from "./nozomi";
import { simulateAndGetTokensBalance } from "./simulateAndGetTokensBalance";

export type JupiterSwapSettledResult =
  | { status: "fulfilled"; value: JupiterSwapBuildSuccess }
  | { status: "rejected"; reason: JupiterSwapBuildError };

type JupiterSwapBuildSuccess = {
  tx: VersionedTransaction;
  quote: JupQuoteResponse;
};

type JupiterSwapBuildError = {
  errorType: "QUOTE_ERROR" | "INSTRUCTIONS_ERROR" | "SIMULATION_ERROR";
  errorMessage: string;
  raw: any;
};

export async function buildJupSwapTransaction({
  userAddress,
  inputMint,
  outputMint,
  inputAmount,
  slippageBps,
  blockhash,
  useNozomi,
  skipCloseAccount,
  options,
}: {
  userAddress: Address;
  inputMint: Address;
  outputMint: Address;
  inputAmount: number;
  slippageBps: number;
  useNozomi?: boolean;
  blockhash?: string;
  skipCloseAccount?: boolean;
  options?: Parameters<typeof getJupSwapInstructions>[0]["options"];
}) {
  console.time("Jupiter quote");

  // Quote
  const quoteRes = await tryCatch(
    getJupSwapQuote({
      inputMint,
      outputMint,
      inputAmount,
      slippageBps,
    })
  );

  if (quoteRes.error) {
    throw {
      errorType: "QUOTE_ERROR",
      errorMessage: quoteRes.error.message ?? "Failed to fetch quote",
      raw: quoteRes.error,
    };
  }

  const { data: quote } = quoteRes;

  // Fetch Instructions
  const instructionsRes = await tryCatch(
    getJupSwapInstructions({
      userAddress,
      quote,
      options,
    })
  );

  if (instructionsRes.error) {
    throw {
      errorType: "INSTRUCTIONS_ERROR",
      errorMessage: instructionsRes.error.message ?? "Failed to fetch instructions",
      raw: instructionsRes.error,
    };
  }

  const { data: inst } = instructionsRes;

  // Fetch lookup tables
  const fetchALT = inst.addressLookupTableAddresses.map((lt) =>
    connection.getAddressLookupTable(new PublicKey(lt)).then((res) => res.value)
  );
  const altAccounts = await Promise.all(fetchALT);

  // Compute budget priority selection
  const cuIxs = options?.priorityLevelWithMaxLamports
    ? inst.computeBudgetInstructions.map((i) => buildIx(i))
    : getCuInstructions();

  // Build all instructions
  let allInstructions: TransactionInstruction[] = [
    ...inst.setupInstructions.map(buildIx),
    ...cuIxs,
    ...inst.otherInstructions.map(buildIx),
    buildIx(inst.swapInstruction),
    ...(inst.cleanupInstruction ? [buildIx(inst.cleanupInstruction)] : []),
  ];

  if (skipCloseAccount) {
    allInstructions = allInstructions.filter((ix) => !isTokenClose(ix));
  }

  if (useNozomi) {
    allInstructions.push(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(userAddress),
        toPubkey: new PublicKey(getRandomNozomiTipPubkey()),
        lamports: 1_050_000,
      })
    );
  }

  const msg = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash: blockhash ?? (await connection.getLatestBlockhash()).blockhash,
    instructions: allInstructions,
  }).compileToV0Message(altAccounts.filter((a) => a !== null));

  const tx = new VersionedTransaction(msg);

  console.timeEnd("Jupiter quote");

  return { tx, quote };
}

function buildIx(raw: {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}) {
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    data: Buffer.from(raw.data, "base64"),
    keys: raw.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
  });
}

export async function buildAndSimulateJupiterSwap(params: {
  userAddress: Address;
  inputMint: Address;
  outputMint: Address;
  inputAmount: number;
  slippageBps: number;
  blockhash?: string;
  useNozomi: boolean;
  skipCloseAccount?: boolean;
  options?: Parameters<typeof getJupSwapInstructions>[0]["options"];
}) {
  const { tx, quote } = await buildJupSwapTransaction(params);

  const simRes = await simulateAndGetTokensBalance({ userAddress: params.userAddress, transaction: tx });

  if (simRes.sim.err) {
    console.log("Log", simRes.sim.logs);
    console.error(`Swap Simulation Error: ${JSON.stringify(simRes.sim.err)}`);
    return {
      ok: false as const,
      errorType: "SIMULATION_ERROR",
      errorMessage: JSON.stringify(simRes.sim.err),
    };
  }

  return { ok: true as const, tx, quote };
}
