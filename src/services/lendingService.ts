/**
 * MnM Lending Protocol Service
 * Transaction builders for interacting with the lending pool
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import BN from "bn.js";

// Program ID from deployed contract
export const LENDING_PROGRAM_ID = new PublicKey(
  "EswKHJ3PtYsCpywWvX4wosJXjJbswYjqwE9E6wLGVCFS",
);

// USDC Mint (mainnet)
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

// Instruction discriminators (Anchor uses 8-byte discriminators)
const INSTRUCTION_DISCRIMINATORS = {
  initializePool: Buffer.from([95, 180, 10, 172, 84, 174, 232, 40]),
  deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
  withdraw: Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]),
  borrow: Buffer.from([228, 253, 131, 202, 207, 116, 89, 18]),
  repay: Buffer.from([234, 103, 67, 82, 208, 234, 219, 166]),
};

/**
 * Derive the pool PDA
 */
export function derivePoolPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    LENDING_PROGRAM_ID,
  );
}

/**
 * Derive user position PDA
 */
export function deriveUserPositionPDA(
  pool: PublicKey,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), pool.toBuffer(), user.toBuffer()],
    LENDING_PROGRAM_ID,
  );
}

/**
 * Derive loan PDA
 */
export function deriveLoanPDA(
  pool: PublicKey,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), pool.toBuffer(), user.toBuffer()],
    LENDING_PROGRAM_ID,
  );
}

/**
 * Build deposit transaction
 */
export async function buildDepositTransaction(
  connection: Connection,
  user: PublicKey,
  amount: BN,
  mint: PublicKey = USDC_MINT,
): Promise<Transaction> {
  const [pool, poolBump] = derivePoolPDA(mint);
  const [userPosition] = deriveUserPositionPDA(pool, user);

  // Get user's token account
  const userTokenAccount = await getAssociatedTokenAddress(mint, user);

  // Get pool vault (pool is the authority)
  const vault = await getAssociatedTokenAddress(mint, pool, true);

  // Build instruction data: discriminator + amount (u64)
  const data = Buffer.alloc(16);
  INSTRUCTION_DISCRIMINATORS.deposit.copy(data, 0);
  amount.toArrayLike(Buffer, "le", 8).copy(data, 8);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userPosition, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: LENDING_PROGRAM_ID,
    data,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

/**
 * Build withdraw transaction
 */
export async function buildWithdrawTransaction(
  connection: Connection,
  user: PublicKey,
  amount: BN,
  mint: PublicKey = USDC_MINT,
): Promise<Transaction> {
  const [pool] = derivePoolPDA(mint);
  const [userPosition] = deriveUserPositionPDA(pool, user);

  const userTokenAccount = await getAssociatedTokenAddress(mint, user);
  const vault = await getAssociatedTokenAddress(mint, pool, true);

  // Build instruction data
  const data = Buffer.alloc(16);
  INSTRUCTION_DISCRIMINATORS.withdraw.copy(data, 0);
  amount.toArrayLike(Buffer, "le", 8).copy(data, 8);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userPosition, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: LENDING_PROGRAM_ID,
    data,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

/**
 * Build borrow transaction
 */
export async function buildBorrowTransaction(
  connection: Connection,
  user: PublicKey,
  amount: BN,
  collateralPrice: BN,
  borrowPrice: BN,
  mint: PublicKey = USDC_MINT,
): Promise<Transaction> {
  const [pool] = derivePoolPDA(mint);
  const [loan] = deriveLoanPDA(pool, user);

  const userTokenAccount = await getAssociatedTokenAddress(mint, user);
  const vault = await getAssociatedTokenAddress(mint, pool, true);

  // Build instruction data: discriminator + amount + collateralPrice + borrowPrice
  const data = Buffer.alloc(32);
  INSTRUCTION_DISCRIMINATORS.borrow.copy(data, 0);
  amount.toArrayLike(Buffer, "le", 8).copy(data, 8);
  collateralPrice.toArrayLike(Buffer, "le", 8).copy(data, 16);
  borrowPrice.toArrayLike(Buffer, "le", 8).copy(data, 24);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: loan, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: LENDING_PROGRAM_ID,
    data,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

/**
 * Build repay transaction
 */
export async function buildRepayTransaction(
  connection: Connection,
  user: PublicKey,
  amount: BN,
  mint: PublicKey = USDC_MINT,
): Promise<Transaction> {
  const [pool] = derivePoolPDA(mint);
  const [loan] = deriveLoanPDA(pool, user);

  const userTokenAccount = await getAssociatedTokenAddress(mint, user);
  const vault = await getAssociatedTokenAddress(mint, pool, true);

  // Build instruction data
  const data = Buffer.alloc(16);
  INSTRUCTION_DISCRIMINATORS.repay.copy(data, 0);
  amount.toArrayLike(Buffer, "le", 8).copy(data, 8);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: loan, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: LENDING_PROGRAM_ID,
    data,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;

  return transaction;
}

/**
 * Fetch pool state
 */
export async function fetchPoolState(
  connection: Connection,
  mint: PublicKey = USDC_MINT,
) {
  const [pool] = derivePoolPDA(mint);

  const accountInfo = await connection.getAccountInfo(pool);
  if (!accountInfo) {
    return null;
  }

  // Parse pool data (skip 8-byte discriminator)
  const data = accountInfo.data.slice(8);

  return {
    authority: new PublicKey(data.slice(0, 32)),
    mint: new PublicKey(data.slice(32, 64)),
    vault: new PublicKey(data.slice(64, 96)),
    totalDeposits: new BN(data.slice(96, 104), "le"),
    totalBorrows: new BN(data.slice(104, 112), "le"),
    interestRateBps: data.readUInt16LE(112),
    lastUpdate: new BN(data.slice(114, 122), "le"),
    bump: data[122],
  };
}

/**
 * Fetch user position
 */
export async function fetchUserPosition(
  connection: Connection,
  user: PublicKey,
  mint: PublicKey = USDC_MINT,
) {
  const [pool] = derivePoolPDA(mint);
  const [userPosition] = deriveUserPositionPDA(pool, user);

  const accountInfo = await connection.getAccountInfo(userPosition);
  if (!accountInfo) {
    return null;
  }

  const data = accountInfo.data.slice(8);

  return {
    owner: new PublicKey(data.slice(0, 32)),
    deposited: new BN(data.slice(32, 40), "le"),
    lastUpdate: new BN(data.slice(40, 48), "le"),
  };
}

/**
 * Build atomic leverage transaction
 */
export async function buildAtomicLeverageTransaction({
  connection,
  user,
  collateralAmount,
  leverage,
  pool,
}: {
  connection: Connection;
  user: PublicKey;
  collateralAmount: number;
  leverage: number;
  pool: PublicKey;
}): Promise<Transaction> {
  // This is a placeholder for the full transaction composition.
  // In a real scenario, this would involve multiple instructions:
  // 1. Flash borrow from the pool
  // 2. Swap for the collateral asset (e.g., SOL)
  // 3. Deposit collateral into a new loan account
  // 4. Borrow against the new collateral
  // 5. Repay the flash loan

  console.log("Building atomic leverage transaction for:", {
    user: user.toBase58(),
    collateralAmount,
    leverage,
  });

  // For demonstration, we'll just create a simple system transfer
  // to represent the transaction that would be sent.
  const transaction = new Transaction();

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: user, // Sending to self as a placeholder
      lamports: 100000, // 0.0001 SOL, placeholder fee/amount
    }),
  );

  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  transaction.feePayer = user;

  return transaction;
}
