import { Infer } from "convex/values";

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../convexEnv";
import { TitanSwapInstructionV } from "../types/titanSwapQuote";
import { getRandomNozomiTipPubkey } from "./nozomi";
import { getCachedALT } from "../services/solana";
import { isTokenClose } from "../utils/solana";

const TITAN_JITO_FRONT_RUN = "jitodontfronttitana111111111111111111111111";
export async function buildTitanSwapTransaction({
  instructions,
  lookupTables,
  userAddress,
  skipCloseAccount,
  options,
}: {
  instructions: Infer<typeof TitanSwapInstructionV>[];
  lookupTables: string[];
  userAddress: string;
  skipCloseAccount?: boolean;
  options?: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    useNozomi?: boolean;
    removeJitoFrontRun?: boolean;
    recentBlockhash: string;
  };
}) {
  let ixList: TransactionInstruction[] = [];

  if (options?.cuLimit || options?.cuPriceMicroLamports) {
    ixList.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: options.cuLimit ?? 1_000_000,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.cuPriceMicroLamports ?? 1_000_000,
      }),
    );
  }

  for (const ix of instructions) {
    const programId = new PublicKey(ix.program);
    const keys = ix.accounts
      .map((acc) => {
        if (options?.removeJitoFrontRun && acc.pubkey === TITAN_JITO_FRONT_RUN)
          return null;
        return {
          pubkey: new PublicKey(acc.pubkey),
          isSigner: acc.s,
          isWritable: acc.w,
        };
      })
      .filter((k): k is NonNullable<typeof k> => k !== null);

    const data = Buffer.from(ix.data, "base64");
    const instruction = new TransactionInstruction({ programId, keys, data });

    ixList.push(instruction);
  }

  if (options?.useNozomi) {
    ixList.push(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(userAddress),
        toPubkey: new PublicKey(getRandomNozomiTipPubkey()),
        lamports: 1_050_000,
      }),
    );
  }

  if (skipCloseAccount) {
    ixList = ixList.filter((ix) => !isTokenClose(ix));
  }

  // const a = ixList.filter((_, i) => i !== 2);
  const altAccounts = await Promise.all(
    lookupTables.map((lt) => getCachedALT(lt)),
  );

  // Filter null values (missing ALTs)
  const alts = altAccounts.filter(
    (a): a is AddressLookupTableAccount => a !== null,
  );

  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash:
      options?.recentBlockhash ??
      (await connection.getLatestBlockhash()).blockhash,
    instructions: ixList,
  }).compileToV0Message(alts);

  return new VersionedTransaction(message);
}
