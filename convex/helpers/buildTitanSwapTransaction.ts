import { Infer } from "convex/values";

import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../convexEnv";
import { TitanSwapInstructionV } from "../types/titanSwapQuote";

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
    const keys = ix.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.s,
      isWritable: acc.w,
    }));
    const data = Buffer.from(ix.data, "base64");
    ixList.push(new TransactionInstruction({ programId, keys, data }));
  }

  ///lookup table

  const fetchALT = lookupTables.map((lt) =>
    connection.getAddressLookupTable(new PublicKey(lt)).then((res) => res.value)
  );
  const altAccounts = await Promise.all(fetchALT);

  console.log("ALTSSS==1==11=1=", altAccounts);
  // ✅ compile with lookup tables
  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash: options?.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash,
    instructions: ixList,
  }).compileToV0Message(altAccounts.filter((a) => a !== null));

  return new VersionedTransaction(message);
}
