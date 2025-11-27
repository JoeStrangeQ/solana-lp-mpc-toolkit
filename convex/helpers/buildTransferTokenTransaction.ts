import {
  SystemProgram,
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

import { NATIVE_MINT } from "@solana/spl-token";
import { connection } from "../convexEnv";

export async function buildTransferTokenTransaction({
  from,
  recipient,
  mint,
  rawAmount,
  options,
}: {
  from: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  rawAmount: number;
  options?: {
    cuLimit?: number;
    cuPriceMicroLamports?: number;
    recentBlockhash: string;
    skipAtaCreation?: boolean;
  };
}): Promise<VersionedTransaction> {
  const instructions: TransactionInstruction[] = [];

  if (options?.cuLimit || options?.cuPriceMicroLamports) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: options.cuLimit ?? 1_000_000,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.cuPriceMicroLamports ?? 1_000_000,
      })
    );
  }

  if (mint.equals(NATIVE_MINT)) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: recipient,
        lamports: rawAmount,
      })
    );
  } else {
    const [sourceAta, destAta] = await Promise.all([
      getAssociatedTokenAddress(mint, from, false),
      getAssociatedTokenAddress(mint, recipient, false),
    ]);

    // Check destination ATA
    if (!options?.skipAtaCreation) {
      const destInfo = await connection.getAccountInfo(destAta);

      if (!destInfo) {
        // Create recipient ATA
        instructions.push(
          createAssociatedTokenAccountInstruction(
            from, // payer
            destAta, // ATA
            recipient, // owner
            mint
          )
        );
      }
    }

    instructions.push(createTransferInstruction(sourceAta, destAta, from, rawAmount));
  }

  const { blockhash: recentBlockhash } = options?.recentBlockhash
    ? { blockhash: options?.recentBlockhash }
    : await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: from,
    recentBlockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}
