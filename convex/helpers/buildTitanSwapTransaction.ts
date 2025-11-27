import { Infer } from "convex/values";

import {
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

const TITAN_JITO_FRONT_RUN = "jitodontfronttitana111111111111111111111111";
export async function buildTitanSwapTransaction({
  instructions,
  lookupTables,
  userAddress,
  options,
}: {
  instructions: Infer<typeof TitanSwapInstructionV>[];
  lookupTables: string[];
  userAddress: string;
  options?: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    useNozomi?: boolean;
    removeJitoFrontRun?: boolean;
    recentBlockhash: string;
  };
}) {
  const ixList: TransactionInstruction[] = [];

  if (options?.cuLimit || options?.cuPriceMicroLamports) {
    ixList.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: options.cuLimit ?? 1_000_000,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.cuPriceMicroLamports ?? 1_000_000,
      })
    );
  }

  for (const ix of instructions) {
    const programId = new PublicKey(ix.program);
    const keys = ix.accounts
      .map((acc) => {
        if (options?.removeJitoFrontRun && acc.pubkey === TITAN_JITO_FRONT_RUN) return null;
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
      })
    );
  }

  // const a = ixList.filter((_, i) => i !== 2);
  const fetchALT = lookupTables.map((lt) =>
    connection.getAddressLookupTable(new PublicKey(lt)).then((res) => res.value)
  );
  const altAccounts = await Promise.all(fetchALT);

  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
    instructions: ixList,
  }).compileToV0Message(altAccounts.filter((a) => a !== null));

  return new VersionedTransaction(message);
}
