/**
 * Transaction Builder for Wallet-less Agents
 *
 * Returns unsigned transactions that agents can:
 * 1. Forward to user for signing
 * 2. Sign with custodial wallet
 * 3. Use with MPC signing service
 * 
 * NOTE: Currently uses placeholder instructions due to SDK compatibility issues.
 * Real DEX instructions will be added when SDK issues are resolved.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import * as log from './logger';

// Memo program for placeholder instructions
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

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
    expiresAt: number; // Block height
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
 * Create a memo instruction for placeholder transactions
 */
function createMemoInstruction(message: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(message, "utf-8"),
  });
}

/**
 * Build an unsigned add liquidity transaction
 * 
 * Currently builds a placeholder transaction with:
 * - ATA creation instructions (if needed)
 * - Memo instruction describing the intended operation
 * 
 * This demonstrates the full flow and produces a valid, signable transaction.
 */
export async function buildAddLiquidityTx(
  connection: Connection,
  params: AddLiquidityTxParams,
): Promise<UnsignedTxResult> {
  const { userPubkey, poolAddress, venue, tokenA, tokenB, amountA, amountB, slippageBps = 50 } = params;
  
  log.info('Building add liquidity TX', { venue, tokenA, tokenB, amountA, amountB });

  try {
    const user = new PublicKey(userPubkey);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    
    // Create transaction
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: user });
    const instructions: string[] = [];
    
    const tokenAInfo = TOKENS[tokenA.toUpperCase()];
    const tokenBInfo = TOKENS[tokenB.toUpperCase()];
    if (!tokenAInfo || !tokenBInfo) {
      return { success: false, error: `Invalid token symbols: ${tokenA}, ${tokenB}` };
    }

    // Check/create ATAs (real instructions)
    const userAtaA = await getAssociatedTokenAddress(new PublicKey(tokenAInfo.mint), user);
    const ataAInfo = await connection.getAccountInfo(userAtaA);
    if (!ataAInfo) {
      tx.add(createAssociatedTokenAccountInstruction(user, userAtaA, user, new PublicKey(tokenAInfo.mint)));
      instructions.push(`Create ${tokenA} token account`);
    }
    
    const userAtaB = await getAssociatedTokenAddress(new PublicKey(tokenBInfo.mint), user);
    const ataBInfo = await connection.getAccountInfo(userAtaB);
    if (!ataBInfo) {
      tx.add(createAssociatedTokenAccountInstruction(user, userAtaB, user, new PublicKey(tokenBInfo.mint)));
      instructions.push(`Create ${tokenB} token account`);
    }

    // Add memo instruction describing the operation
    // In production, this would be replaced with real DEX instructions
    const memoText = JSON.stringify({
      action: "add_liquidity",
      venue,
      pool: poolAddress,
      tokenA,
      tokenB,
      amountA,
      amountB,
      slippageBps,
      timestamp: Date.now(),
    });
    tx.add(createMemoInstruction(memoText, user));
    instructions.push(`Add ${amountA} ${tokenA} + ${amountB} ${tokenB} to ${venue} pool`);

    // Serialize unsigned transaction
    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      success: true,
      transaction: {
        serialized,
        message: `Add liquidity: ${amountA} ${tokenA} + ${amountB} ${tokenB} to ${venue}`,
        estimatedFee: 0.000005, // ~5000 lamports base fee
        expiresAt: lastValidBlockHeight + 150,
      },
      instructions,
    };

  } catch (error: unknown) {
    const err = error as Error;
    log.error('Failed to build add liquidity TX', { error: err.message });
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
  const { userPubkey, positionId, venue, percentage = 100 } = params;
  
  log.info('Building remove liquidity TX', { venue, positionId, percentage });

  try {
    const user = new PublicKey(userPubkey);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: user });
    const instructions: string[] = [];

    // Add memo instruction describing the operation
    const memoText = JSON.stringify({
      action: "remove_liquidity",
      venue,
      positionId,
      percentage,
      timestamp: Date.now(),
    });
    tx.add(createMemoInstruction(memoText, user));
    instructions.push(`Remove ${percentage}% liquidity from position`);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      success: true,
      transaction: {
        serialized,
        message: `Remove ${percentage}% liquidity from ${venue} position`,
        estimatedFee: 0.000005,
        expiresAt: lastValidBlockHeight + 150,
      },
      instructions,
    };

  } catch (error: unknown) {
    const err = error as Error;
    log.error('Failed to build remove liquidity TX', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Describe what a serialized transaction will do
 */
export function describeTx(serializedTx: string): string {
  try {
    const buffer = Buffer.from(serializedTx, 'base64');
    const tx = Transaction.from(buffer);
    
    const descriptions: string[] = [];
    
    for (const ix of tx.instructions) {
      if (ix.programId.equals(MEMO_PROGRAM_ID)) {
        try {
          const memoData = JSON.parse(ix.data.toString('utf-8'));
          if (memoData.action === 'add_liquidity') {
            descriptions.push(
              `Add ${memoData.amountA} ${memoData.tokenA} + ${memoData.amountB} ${memoData.tokenB} ` +
              `to ${memoData.venue} pool ${memoData.pool?.slice(0, 8)}...`
            );
          } else if (memoData.action === 'remove_liquidity') {
            descriptions.push(
              `Remove ${memoData.percentage}% from ${memoData.venue} position ${memoData.positionId?.slice(0, 8)}...`
            );
          }
        } catch {
          descriptions.push(`Memo: ${ix.data.toString('utf-8').slice(0, 50)}...`);
        }
      } else {
        descriptions.push(`Program: ${ix.programId.toBase58().slice(0, 8)}...`);
      }
    }
    
    return descriptions.join('\n');
  } catch (error) {
    return 'Unable to decode transaction';
  }
}

export default {
  buildAddLiquidityTx,
  buildRemoveLiquidityTx,
  describeTx,
};
