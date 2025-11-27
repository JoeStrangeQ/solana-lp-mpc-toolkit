import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import z from "zod";
import { connection } from "../convexEnv";

export const Base58Z = ({
  invalid_type_error,
  required_error,
  regex_error = "The string is not a Base58",
}: {
  invalid_type_error?: string | undefined;
  required_error?: string | undefined;
  regex_error?: string | undefined;
} = {}) =>
  z
    .string({ invalid_type_error, required_error })
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, regex_error)
    .brand<"Base58">();

export type Base58 = z.infer<ReturnType<typeof Base58Z>>;

export const zAddress = Base58Z({
  regex_error: "Invalid Solana address",
}).refine(
  (value) => {
    try {
      return bs58.decode(value).length === 32;
    } catch {
      return false;
    }
  },
  { message: "Invalid Solana address" }
);
export type Address = z.infer<typeof zAddress>;

export function toAddress(value: string) {
  return zAddress.parse(value);
}

export function isVersionedTransaction(
  transaction: Transaction | VersionedTransaction
): transaction is VersionedTransaction {
  return "version" in transaction;
}

export function toVersioned(tx: Transaction | VersionedTransaction): VersionedTransaction {
  if (isVersionedTransaction(tx)) {
    return tx;
  }
  return new VersionedTransaction(tx.compileMessage());
}

export function isAtaCreation(ix: TransactionInstruction): boolean {
  return ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function isTokenClose(ix: TransactionInstruction): boolean {
  const isTokenProgram = ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID);
  if (!isTokenProgram) return false;

  const instruction = ix.data[0];

  return instruction === 9;
}

export function getCuInstructions({ limit = 1_200_000, price = 1_200_000 } = {}) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
  ];
}

export async function fastTransactionConfirm(signatures: string[], timeoutMs = 1500) {
  const start = Date.now();

  let latestStatuses = new Array(signatures.length).fill(null);

  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses(signatures);
    latestStatuses = value;

    let allDecided = true;

    for (let i = 0; i < value.length; i++) {
      const status = value[i];

      if (!status) {
        // still waiting
        allDecided = false;
        continue;
      }

      if (status.err) {
        // tx failed
        allDecided = true; // decided but failed
        continue;
      }

      if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") {
        allDecided = false; // still pending
      }
    }

    if (allDecided) break;

    await new Promise((r) => setTimeout(r, 25));
  }

  // Now create structured output
  return signatures.map((sig, i) => {
    const status = latestStatuses[i];

    if (!status) return { signature: sig, status: "pending" as const };

    if (status.err) return { signature: sig, status: "failed" as const, err: status.err };

    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
      return { signature: sig, status: "confirmed" as const };
    }

    return { signature: sig, status: "pending" as const };
  });
}

export const mints = {
  sol: toAddress("So11111111111111111111111111111111111111112"),
  usdc: toAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  met: toAddress("METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL"),
} as const;

export type BaseTokenMetadata = { address: Address; name: string; symbol: string; icon: string; decimals: number };
export const tokensMetadata: Record<Address | string, BaseTokenMetadata> = {
  [mints.sol]: {
    address: mints.sol,
    name: "Solana",
    symbol: "SOL",
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    decimals: 9,
  },
  [mints.usdc]: {
    address: mints.usdc,

    name: "USD Coin",
    symbol: "USDC",
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    decimals: 6,
  },
  [mints.met]: {
    address: mints.met,
    name: "Meteora",
    symbol: "MET",
    icon: "https://assets.meteora.ag/met-token.svg",
    decimals: 6,
  },
};
