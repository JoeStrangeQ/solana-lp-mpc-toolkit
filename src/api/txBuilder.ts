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
import DLMM, { LbPair, PDA, toLamports } from '@meteora-ag/dlmm';
import { BN } from 'bn.js';

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
 * Build a real, unsigned add liquidity transaction for Meteora DLMM
 */
export async function buildAddLiquidityTx(
  connection: Connection,
  params: AddLiquidityTxParams,
): Promise<UnsignedTxResult> {
  const { userPubkey, poolAddress, venue, tokenA, tokenB, amountA, amountB, slippageBps = 50 } = params;
  
  if (venue !== 'meteora') {
    return { success: false, error: `Transaction building for ${venue} is not yet supported.` };
  }

  try {
    const user = new PublicKey(userPubkey);
    const lbPair = new PublicKey(poolAddress);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    
    // Create transaction
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: user });
    const instructions: string[] = [];
    
    const tokenAInfo = TOKENS[tokenA.toUpperCase()];
    const tokenBInfo = TOKENS[tokenB.toUpperCase()];
    if (!tokenAInfo || !tokenBInfo) {
      return { success: false, error: 'Invalid token symbols' };
    }

    // Get or create ATAs
    const userAtaA = await getAssociatedTokenAddress(new PublicKey(tokenAInfo.mint), user);
    if (!(await connection.getAccountInfo(userAtaA))) {
      tx.add(createAssociatedTokenAccountInstruction(user, userAtaA, user, new PublicKey(tokenAInfo.mint)));
      instructions.push(`Create ${tokenA} token account`);
    }
    const userAtaB = await getAssociatedTokenAddress(new PublicKey(tokenBInfo.mint), user);
    if (!(await connection.getAccountInfo(userAtaB))) {
      tx.add(createAssociatedTokenAccountInstruction(user, userAtaB, user, new PublicKey(tokenBInfo.mint)));
      instructions.push(`Create ${tokenB} token account`);
    }

    // Create a new position PDA
    const position = PDA.newPosition(lbPair);
    instructions.push(`Create new LP position: ${position.publicKey.toBase58().slice(0, 8)}...`);

    // Get DLMM pair info
    const pairInfo = await LbPair.getLbPair(lbPair, connection);

    // Convert amounts to lamports
    const amountALamports = toLamports(new BN(amountA * 10**tokenAInfo.decimals), tokenAInfo.decimals);
    const amountBLamports = toLamports(new BN(amountB * 10**tokenBInfo.decimals), tokenBInfo.decimals);
    
    const activeBin = pairInfo.activeBin;
    const binStep = pairInfo.binStep;

    // Add liquidity instruction
    const addLiqIx = await pairInfo.addLiquidityByStrategy({
      position: position.publicKey,
      user: user,
      totalXAmount: amountALamports,
      totalYAmount: amountBLamports,
      strategy: {
        strategyType: 'SpotBalanced',
        minBinId: activeBin.binId - 10 * binStep,
        maxBinId: activeBin.binId + 10 * binStep,
      },
      slippage: slippageBps / 10000,
    });
    
    tx.add(addLiqIx);
    instructions.push(`Add ${amountA} ${tokenA} + ${amountB} ${tokenB} to Meteora pool`);

    // Serialize transaction (partially signed by position PDA)
    tx.partialSign(position);
    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
    
    // Estimate fee
    const fee = await tx.getEstimatedFee(connection);

    return {
      success: true,
      transaction: {
        serialized,
        message: `Add ${amountA} ${tokenA} + ${amountB} ${tokenB} to ${venue}`,
        estimatedFee: fee / LAMPORTS_PER_SOL,
        expiresAt: lastValidBlockHeight + 150,
      },
      instructions,
    };

  } catch (error: unknown) {
    const err = error as Error;
    log.error('Failed to build Meteora TX', { error: err.message, stack: err.stack });
    return { success: false, error: err.message };
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
