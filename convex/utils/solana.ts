import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import z from "zod";
import { connection } from "../convexEnv";
import { SupportedMarket } from "../schema/limitOrders";
import BN from "bn.js";
import { safeBigIntToNumber } from "./amounts";

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
  { message: "Invalid Solana address" },
);
export type Address = z.infer<typeof zAddress>;

export function toAddress(value: string) {
  return zAddress.parse(value);
}

export function isVersionedTransaction(
  transaction: Transaction | VersionedTransaction,
): transaction is VersionedTransaction {
  return "version" in transaction;
}

export function toVersioned(
  tx: Transaction | VersionedTransaction,
): VersionedTransaction {
  if (isVersionedTransaction(tx)) {
    return tx;
  }
  return new VersionedTransaction(tx.compileMessage());
}

export function isAtaCreation(ix: TransactionInstruction): boolean {
  return ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function isTokenClose(ix: TransactionInstruction): boolean {
  const isTokenProgram =
    ix.programId.equals(TOKEN_PROGRAM_ID) ||
    ix.programId.equals(TOKEN_2022_PROGRAM_ID);
  if (!isTokenProgram) return false;

  const instruction = ix.data[0];

  return instruction === 9;
}

export function getCuInstructions({
  limit = 1_200_000,
  price = 1_200_000,
} = {}) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
  ];
}

export async function fastTransactionConfirm(
  signatures: string[],
  timeoutMs = 1500,
) {
  const start = Date.now();
  let latestStatuses = new Array(signatures.length).fill(null);

  // Linear delay parameters
  const startDelay = Math.min(50, Math.max(30, timeoutMs * 0.02));
  const increment = Math.min(25, Math.max(15, timeoutMs * 0.01));
  const maxDelay = 200;

  let delay = startDelay;
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses(signatures);
    latestStatuses = value;

    let anyPending = false;

    for (const status of value) {
      if (!status) {
        anyPending = true;
        continue;
      }
      if (
        !status.err &&
        status.confirmationStatus !== "confirmed" &&
        status.confirmationStatus !== "finalized"
      ) {
        anyPending = true;
      }
    }

    if (!anyPending) break;

    await new Promise((r) => setTimeout(r, delay));
    attempt++;
    delay = Math.min(startDelay + attempt * increment, maxDelay);
  }

  const timedOut = Date.now() - start >= timeoutMs;

  return signatures.map((sig, i) => {
    const status = latestStatuses[i];

    // TIMEOUT: no result + no error → treat as timeout
    if (
      timedOut &&
      (!status ||
        (!status.err &&
          status.confirmationStatus !== "confirmed" &&
          status.confirmationStatus !== "finalized"))
    ) {
      return {
        signature: sig,
        status: "failed" as const,
        err: status?.err ?? "Timeout reached",
      };
    }

    if (!status) return { signature: sig, status: "pending" as const };
    if (status.err)
      return { signature: sig, status: "failed" as const, err: status.err };
    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
    ) {
      return { signature: sig, status: "confirmed" as const };
    }

    return { signature: sig, status: "pending" as const };
  });
}

export function buildWrapSolInstructions({
  userAddress,
  lamports,
}: {
  userAddress: Address;
  lamports: number | BN | bigint;
}) {
  if (Number(lamports) <= 0) {
    throw new Error("Amount must be > 0");
  }

  const userPubkey = new PublicKey(userAddress);

  // Compute ATA for WSOL
  const wsolAta = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    userPubkey,
    false,
    TOKEN_PROGRAM_ID,
  );
  const ixCreateAta = createAssociatedTokenAccountIdempotentInstruction(
    userPubkey, // payer
    wsolAta, // ATA to create
    userPubkey, // owner of ATA
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Send SOL into the WSOL ATA
  const ixTransfer = SystemProgram.transfer({
    fromPubkey: userPubkey,
    toPubkey: wsolAta,
    lamports:
      typeof lamports === "number"
        ? lamports
        : safeBigIntToNumber(lamports, "Wrap sol lamports"),
  });

  // Convert native lamports → WSOL SPL balance
  const ixSync = createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID);

  return {
    wsolAta,
    instructions: [ixCreateAta, ixTransfer, ixSync],
  };
}
export const mints = {
  sol: toAddress("So11111111111111111111111111111111111111112"),
  usdc: toAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  met: toAddress("METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL"),
} as const;

export type BaseTokenMetadata = {
  address: Address;
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
};
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

export function getMarketFromMints(
  mintX: string,
  mintY: string,
): SupportedMarket {
  const symX = tokensMetadata[mintX]?.symbol?.toUpperCase();
  const symY = tokensMetadata[mintY]?.symbol?.toUpperCase();

  if (!symX || !symY)
    throw new Error(`There is no avaliable market for ${mintX} and ${mintY}`);

  // Normalize order (SOL-USDC should match USDC-SOL)
  const pair = [symX, symY].sort().join("/");

  switch (pair) {
    case "SOL/USDC":
      return "SOL/USDC";
    case "MET/USDC":
      return "MET/USDC";
    case "MET/SOL":
      return "MET/SOL";
    default:
      throw new Error(`There is no avaliable market for ${mintX} and ${mintY}`);
  }
}
