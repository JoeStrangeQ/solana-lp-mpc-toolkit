/**
 * Transaction Builder for Wallet-less Agents
 *
 * Returns unsigned transactions that agents can:
 * 1. Forward to user for signing
 * 2. Sign with custodial wallet
 * 3. Use with MPC signing service
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// Common token mints
const TOKENS: Record<string, { mint: string; decimals: number }> = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  BONK: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  JTO: { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9 },
  JUP: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
  RAY: { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
};

export interface UnsignedTxResult {
  success: boolean;
  transaction?: {
    serialized: string; // Base64 encoded
    message: string; // Human readable description
    estimatedFee: number;
    expiresAt: number; // Block height or timestamp
  };
  error?: string;
  instructions?: string[];
}

export interface AddLiquidityTxParams {
  userPubkey: string;
  poolAddress: string;
  venue: string;
  tokenA: string;
  tokenB: string;
  amountA: number;
  amountB: number;
  slippageBps?: number;
}

/**
 * Build unsigned add liquidity transaction
 *
 * For hackathon demo: creates a placeholder TX structure
 * In production: would use actual DEX SDK to build real instructions
 */
export async function buildAddLiquidityTx(
  connection: Connection,
  params: AddLiquidityTxParams,
): Promise<UnsignedTxResult> {
  try {
    const { userPubkey, poolAddress, venue, tokenA, tokenB, amountA, amountB } =
      params;
    const user = new PublicKey(userPubkey);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    // Create transaction
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    const instructions: string[] = [];

    // Token A setup (if not SOL)
    const tokenAInfo = TOKENS[tokenA.toUpperCase()];
    if (tokenAInfo && tokenA.toUpperCase() !== "SOL") {
      const mintA = new PublicKey(tokenAInfo.mint);
      const ataA = await getAssociatedTokenAddress(mintA, user);

      // Check if ATA exists, if not add create instruction
      const ataAInfo = await connection.getAccountInfo(ataA);
      if (!ataAInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(user, ataA, user, mintA),
        );
        instructions.push(`Create ${tokenA} token account`);
      }
    }

    // Token B setup (if not SOL)
    const tokenBInfo = TOKENS[tokenB.toUpperCase()];
    if (tokenBInfo && tokenB.toUpperCase() !== "SOL") {
      const mintB = new PublicKey(tokenBInfo.mint);
      const ataB = await getAssociatedTokenAddress(mintB, user);

      const ataBInfo = await connection.getAccountInfo(ataB);
      if (!ataBInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(user, ataB, user, mintB),
        );
        instructions.push(`Create ${tokenB} token account`);
      }
    }

    // Add liquidity instruction placeholder
    // In production: would use actual DEX SDK (Meteora, Orca, etc.)
    // For demo: add a memo instruction showing intent
    const memoProgram = new PublicKey(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    const memoData = Buffer.from(
      JSON.stringify({
        action: "add_liquidity",
        venue,
        pool: poolAddress,
        tokenA,
        tokenB,
        amountA,
        amountB,
        encrypted: true, // Indicates Arcium privacy
      }),
    );

    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: user, isSigner: true, isWritable: false }],
        programId: memoProgram,
        data: memoData,
      }),
    );
    instructions.push(
      `Add ${amountA} ${tokenA} + ${amountB} ${tokenB} to ${venue} pool`,
    );

    // Serialize transaction
    const serialized = tx
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString("base64");

    // Estimate fee
    const feeEstimate = 0.000005; // ~5000 lamports

    return {
      success: true,
      transaction: {
        serialized,
        message: `Add liquidity: ${amountA} ${tokenA} + ${amountB} ${tokenB} to ${venue}`,
        estimatedFee: feeEstimate,
        expiresAt: lastValidBlockHeight + 150, // ~1 minute
      },
      instructions,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Build unsigned remove liquidity transaction
 */
export async function buildRemoveLiquidityTx(
  connection: Connection,
  params: {
    userPubkey: string;
    positionId: string;
    venue: string;
    percentage?: number;
  },
): Promise<UnsignedTxResult> {
  try {
    const { userPubkey, positionId, venue, percentage = 100 } = params;
    const user = new PublicKey(userPubkey);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    // Memo placeholder for remove liquidity
    const memoProgram = new PublicKey(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: user, isSigner: true, isWritable: false }],
        programId: memoProgram,
        data: Buffer.from(
          JSON.stringify({
            action: "remove_liquidity",
            venue,
            positionId,
            percentage,
          }),
        ),
      }),
    );

    const serialized = tx
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString("base64");

    return {
      success: true,
      transaction: {
        serialized,
        message: `Remove ${percentage}% liquidity from position`,
        estimatedFee: 0.000005,
        expiresAt: lastValidBlockHeight + 150,
      },
      instructions: [
        `Remove ${percentage}% from ${venue} position ${positionId.slice(0, 8)}...`,
      ],
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Decode and display transaction for user confirmation
 */
export function describeTx(serializedTx: string): {
  feePayer: string;
  instructions: number;
  estimatedFee: string;
} {
  try {
    const buffer = Buffer.from(serializedTx, "base64");
    const tx = Transaction.from(buffer);

    return {
      feePayer: tx.feePayer?.toBase58() || "Unknown",
      instructions: tx.instructions.length,
      estimatedFee: "~0.000005 SOL",
    };
  } catch {
    return {
      feePayer: "Unable to decode",
      instructions: 0,
      estimatedFee: "Unknown",
    };
  }
}

export default {
  buildAddLiquidityTx,
  buildRemoveLiquidityTx,
  describeTx,
  TOKENS,
};
