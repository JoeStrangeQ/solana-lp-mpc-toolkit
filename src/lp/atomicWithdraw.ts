/**
 * Atomic Withdrawal via Jito Bundle
 * 
 * Withdraw LP → Collect 1% fee → All atomic via Jito
 * Strategy encrypted with Arcium before execution
 */

import { Connection, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { config } from '../config/index.js';
import { arciumPrivacy } from '../privacy/index.js';
import { buildTipTransaction, TipSpeed } from '../jito/index.js';
import { FEE_CONFIG, calculateFee } from '../fees/index.js';

export interface AtomicWithdrawParams {
  walletAddress: string;
  poolAddress: string;
  positionAddress: string;
  outputToken?: 'SOL' | 'USDC' | null; // Convert to single token (null = keep both)
  tipSpeed?: TipSpeed;
}

export interface BuiltAtomicWithdraw {
  unsignedTransactions: string[]; // Base64 encoded unsigned txs
  estimatedWithdraw: {
    tokenX: { mint: string; amount: string; decimals: number };
    tokenY: { mint: string; amount: string; decimals: number };
  };
  fee: {
    bps: number;
    estimatedSol: number;
    estimatedUsdc: number;
    treasury: string;
  };
  encryptedStrategy?: { ciphertext: string; nonce: string };
}

/**
 * Build atomic withdrawal transactions:
 * 1. Withdraw all liquidity from position
 * 2. Collect 1% fee (in withdrawn tokens)
 * 3. Close position
 * 4. Jito tip
 */
export async function buildAtomicWithdraw(params: AtomicWithdrawParams): Promise<BuiltAtomicWithdraw> {
  const { walletAddress, poolAddress, positionAddress, tipSpeed = 'fast' } = params;
  const connection = new Connection(config.solana.rpc);

  // 1. Encrypt withdrawal intent with Arcium
  const encrypted = await arciumPrivacy.encryptStrategy({
    intent: 'atomic_withdraw',
    pool: poolAddress,
    amount: 0, // Will be filled after position query
  } as any);

  // 2. Get pool and position info
  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const userPositions = await pool.getPositionsByUserAndLbPair(new PublicKey(walletAddress));
  
  const position = userPositions.userPositions.find(
    (p: any) => p.publicKey.toBase58() === positionAddress
  );

  if (!position) {
    throw new Error(`Position ${positionAddress} not found in pool ${poolAddress}`);
  }

  // Get position data
  const positionData = position.positionData;
  const lowerBinId = positionData.lowerBinId;
  const upperBinId = positionData.upperBinId;
  
  // Estimate amounts from position (rough estimate based on bin range)
  // In practice, the actual amounts will be determined by the removeLiquidity call
  const totalXAmount = new BN(positionData.totalXAmount?.toString() || '0');
  const totalYAmount = new BN(positionData.totalYAmount?.toString() || '0');

  const [tokenXMint, tokenYMint] = [pool.tokenX.publicKey.toBase58(), pool.tokenY.publicKey.toBase58()];
  const [decimalsX, decimalsY] = [pool.tokenX.mint.decimals, pool.tokenY.mint.decimals];

  // Check minimum withdrawal
  const solMint = 'So11111111111111111111111111111111111111112';
  if (tokenXMint === solMint && totalXAmount.toNumber() > 0 && totalXAmount.toNumber() < FEE_CONFIG.MIN_WITHDRAW_LAMPORTS) {
    throw new Error(`Withdrawal too small. Minimum: ${FEE_CONFIG.MIN_WITHDRAW_LAMPORTS / 1e9} SOL`);
  }

  // 3. Calculate 1% fee on withdrawn amounts
  const feeX = calculateFee(totalXAmount.toNumber());
  const feeY = calculateFee(totalYAmount.toNumber());

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const unsignedTransactions: VersionedTransaction[] = [];
  const userPubkey = new PublicKey(walletAddress);

  // 4. Build withdraw transaction
  const withdrawTx = await pool.removeLiquidity({
    position: position.publicKey,
    user: userPubkey,
    fromBinId: lowerBinId,
    toBinId: upperBinId,
    bps: new BN(10000), // 100% of liquidity
    shouldClaimAndClose: true, // Also claim fees and close position
  });

  // Build versioned transaction for withdraw
  // Meteora SDK returns Transaction[] - serialize each one
  const withdrawTxArray = Array.isArray(withdrawTx) ? withdrawTx : [withdrawTx];
  
  for (const tx of withdrawTxArray) {
    if ('recentBlockhash' in tx) {
      // It's a legacy Transaction - set blockhash and serialize
      tx.recentBlockhash = blockhash;
      tx.feePayer = userPubkey;
      const serialized = tx.serialize({ requireAllSignatures: false });
      // Convert to VersionedTransaction for consistency
      const vtx = VersionedTransaction.deserialize(serialized);
      unsignedTransactions.push(vtx);
    } else if ('instructions' in tx) {
      // It's instruction-like, build new transaction
      const msg = new TransactionMessage({
        payerKey: userPubkey,
        recentBlockhash: blockhash,
        instructions: tx.instructions.filter((ix: any) => 
          // Filter out duplicate compute budget instructions
          !ix.programId.equals(ComputeBudgetProgram.programId)
        ),
      }).compileToV0Message();
      unsignedTransactions.push(new VersionedTransaction(msg));
    }
  }

  // 5. Build fee transfer transaction
  const feeInstructions: any[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
  ];

  // Fee for token X (if not dust)
  if (feeX.feeAmount >= FEE_CONFIG.MIN_FEE_LAMPORTS || tokenXMint !== solMint) {
    if (tokenXMint === solMint) {
      // SOL fee
      feeInstructions.push(
        SystemProgram.transfer({
          fromPubkey: userPubkey,
          toPubkey: FEE_CONFIG.TREASURY_ADDRESS,
          lamports: feeX.feeAmount,
        })
      );
    } else {
      // SPL token fee
      const userAtaX = await getAssociatedTokenAddress(new PublicKey(tokenXMint), userPubkey);
      const treasuryAtaX = await getAssociatedTokenAddress(new PublicKey(tokenXMint), FEE_CONFIG.TREASURY_ADDRESS);
      
      // Create treasury ATA if needed
      try {
        await getAccount(connection, treasuryAtaX);
      } catch {
        feeInstructions.push(
          createAssociatedTokenAccountInstruction(
            userPubkey,
            treasuryAtaX,
            FEE_CONFIG.TREASURY_ADDRESS,
            new PublicKey(tokenXMint)
          )
        );
      }
      
      if (feeX.feeAmount > 0) {
        feeInstructions.push(
          createTransferInstruction(
            userAtaX,
            treasuryAtaX,
            userPubkey,
            feeX.feeAmount
          )
        );
      }
    }
  }

  // Fee for token Y (if not dust)
  if (feeY.feeAmount > 0) {
    if (tokenYMint === solMint) {
      // SOL fee
      feeInstructions.push(
        SystemProgram.transfer({
          fromPubkey: userPubkey,
          toPubkey: FEE_CONFIG.TREASURY_ADDRESS,
          lamports: feeY.feeAmount,
        })
      );
    } else {
      // SPL token fee (likely USDC)
      const userAtaY = await getAssociatedTokenAddress(new PublicKey(tokenYMint), userPubkey);
      const treasuryAtaY = await getAssociatedTokenAddress(new PublicKey(tokenYMint), FEE_CONFIG.TREASURY_ADDRESS);
      
      // Create treasury ATA if needed
      try {
        await getAccount(connection, treasuryAtaY);
      } catch {
        feeInstructions.push(
          createAssociatedTokenAccountInstruction(
            userPubkey,
            treasuryAtaY,
            FEE_CONFIG.TREASURY_ADDRESS,
            new PublicKey(tokenYMint)
          )
        );
      }
      
      if (feeY.feeAmount > 0) {
        feeInstructions.push(
          createTransferInstruction(
            userAtaY,
            treasuryAtaY,
            userPubkey,
            feeY.feeAmount
          )
        );
      }
    }
  }

  // Build fee transaction
  if (feeInstructions.length > 1) { // More than just compute budget
    const feeMsg = new TransactionMessage({
      payerKey: userPubkey,
      recentBlockhash: blockhash,
      instructions: feeInstructions,
    }).compileToV0Message();
    unsignedTransactions.push(new VersionedTransaction(feeMsg));
  }

  // 6. Build Jito tip transaction
  const { transaction: tipTx } = buildTipTransaction({
    payerAddress: walletAddress,
    recentBlockhash: blockhash,
    speed: tipSpeed,
  });
  unsignedTransactions.push(tipTx);

  return {
    unsignedTransactions: unsignedTransactions.map(tx => Buffer.from(tx.serialize()).toString('base64')),
    estimatedWithdraw: {
      tokenX: {
        mint: tokenXMint,
        amount: totalXAmount.toString(),
        decimals: decimalsX,
      },
      tokenY: {
        mint: tokenYMint,
        amount: totalYAmount.toString(),
        decimals: decimalsY,
      },
    },
    fee: {
      bps: FEE_CONFIG.FEE_BPS,
      estimatedSol: tokenXMint === solMint ? feeX.feeAmount / 1e9 : 0,
      estimatedUsdc: tokenYMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? feeY.feeAmount / 1e6 : 0,
      treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
    },
    encryptedStrategy: {
      ciphertext: encrypted.ciphertext.slice(0, 32) + '...',
      nonce: encrypted.nonce,
    },
  };
}

export default { buildAtomicWithdraw };
