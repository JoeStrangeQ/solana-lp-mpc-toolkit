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
import { getTokenPrices } from '../utils/prices.js';
import { resolveTokens } from '../utils/token-metadata.js';
import { jupiterClient, TOKENS } from '../swap/jupiter.js';

export interface AtomicWithdrawParams {
  walletAddress: string;
  poolAddress: string;
  positionAddress: string;
  outputToken?: 'SOL' | 'USDC' | null; // Convert to single token (null = keep both)
  convertToSol?: boolean; // Convert ALL withdrawn tokens to SOL
  tipSpeed?: TipSpeed;
}

export interface TokenPnlDetail {
  amount: string;
  symbol: string;
  usd: number;
}

export interface PnlSummary {
  // What you're withdrawing
  withdrawValue: {
    tokenX: TokenPnlDetail;
    tokenY: TokenPnlDetail;
    totalUsd: number;
  };
  // Fees earned (already included in withdrawValue)
  feesEarned: {
    tokenX: TokenPnlDetail;
    tokenY: TokenPnlDetail;
    totalUsd: number;
    note: string;
  };
  // Protocol fee (1%)
  protocolFee: {
    tokenX: { amount: string; usd: number };
    tokenY: { amount: string; usd: number };
    totalUsd: number;
    rate: string;
  };
  // Net to user after protocol fee
  netToUser: {
    totalUsd: number;
  };
  // Summary message
  summary: string;
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
  swap?: {
    enabled: boolean;
    inputAmount?: string;
    outputAmount?: string;
    route?: string;
    note?: string;
  };
  encryptedStrategy?: { ciphertext: string; nonce: string };
  pnl?: PnlSummary;
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

  // Get fees from position (lifetime fees earned)
  const unclaimedFeeX = new BN(positionData.feeX?.toString() || '0');
  const unclaimedFeeY = new BN(positionData.feeY?.toString() || '0');
  const claimedFeeX = new BN(positionData.totalClaimedFeeXAmount?.toString() || '0');
  const claimedFeeY = new BN(positionData.totalClaimedFeeYAmount?.toString() || '0');

  // Total fees earned over lifetime
  const totalFeesX = unclaimedFeeX.add(claimedFeeX);
  const totalFeesY = unclaimedFeeY.add(claimedFeeY);

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

  // 6. If convertToSol requested, add Jupiter swap transactions
  let swapDetails: { inputAmount: string; outputAmount: string; route: string } | undefined;
  if (params.convertToSol && tokenYMint !== solMint) {
    // Calculate amount to swap (total Y minus fee)
    const amountToSwap = totalYAmount.toNumber() - feeY.feeAmount;
    
    if (amountToSwap > 0) {
      try {
        console.log(`[AtomicWithdraw] Getting Jupiter quote to swap ${amountToSwap} ${tokenYMint} → SOL`);
        
        const { quote, swap } = await jupiterClient.getSwapTransaction(
          tokenYMint,
          solMint,
          amountToSwap,
          walletAddress,
          100 // 1% slippage for atomic bundle
        );
        
        // Add swap transaction to bundle
        const swapTx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
        unsignedTransactions.push(swapTx);
        
        swapDetails = {
          inputAmount: quote.inAmount,
          outputAmount: quote.outAmount,
          route: quote.routePlan.map(r => r.swapInfo.label).join(' → '),
        };
        
        console.log(`[AtomicWithdraw] Added swap: ${quote.inAmount} → ${quote.outAmount} SOL via ${swapDetails.route}`);
      } catch (swapError: any) {
        console.warn(`[AtomicWithdraw] Jupiter swap failed, will return tokens as-is:`, swapError.message);
        // Don't fail the whole withdrawal - just skip the swap
      }
    }
  }
  
  // Also swap token X if it's not SOL (e.g., MET in MET-SOL pool)
  if (params.convertToSol && tokenXMint !== solMint) {
    const amountToSwapX = totalXAmount.toNumber() - feeX.feeAmount;
    
    if (amountToSwapX > 0) {
      try {
        console.log(`[AtomicWithdraw] Getting Jupiter quote to swap ${amountToSwapX} ${tokenXMint} → SOL`);
        
        const { quote, swap } = await jupiterClient.getSwapTransaction(
          tokenXMint,
          solMint,
          amountToSwapX,
          walletAddress,
          100 // 1% slippage
        );
        
        const swapTx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
        unsignedTransactions.push(swapTx);
        
        console.log(`[AtomicWithdraw] Added X swap: ${quote.inAmount} → ${quote.outAmount} SOL`);
      } catch (swapError: any) {
        console.warn(`[AtomicWithdraw] Jupiter X swap failed:`, swapError.message);
      }
    }
  }

  // 7. Build Jito tip transaction
  const { transaction: tipTx } = buildTipTransaction({
    payerAddress: walletAddress,
    recentBlockhash: blockhash,
    speed: tipSpeed,
  });
  unsignedTransactions.push(tipTx);

  // 7. Calculate PnL summary with USD values
  let pnl: PnlSummary | undefined;
  try {
    // Get current USD prices
    const prices = await getTokenPrices([tokenXMint, tokenYMint]);
    const priceX = prices.get(tokenXMint) || 0;
    const priceY = prices.get(tokenYMint) || 0;

    // Resolve token symbols
    const tokenMetadata = await resolveTokens([tokenXMint, tokenYMint]);
    const symbolX = tokenMetadata.get(tokenXMint)?.symbol || 'Unknown';
    const symbolY = tokenMetadata.get(tokenYMint)?.symbol || 'Unknown';

    // Calculate amounts in human-readable format
    const withdrawXHuman = Number(totalXAmount.toString()) / Math.pow(10, decimalsX);
    const withdrawYHuman = Number(totalYAmount.toString()) / Math.pow(10, decimalsY);
    const feesXHuman = Number(totalFeesX.toString()) / Math.pow(10, decimalsX);
    const feesYHuman = Number(totalFeesY.toString()) / Math.pow(10, decimalsY);
    const protocolFeeXHuman = feeX.feeAmount / Math.pow(10, decimalsX);
    const protocolFeeYHuman = feeY.feeAmount / Math.pow(10, decimalsY);

    // Calculate USD values
    const withdrawXUsd = withdrawXHuman * priceX;
    const withdrawYUsd = withdrawYHuman * priceY;
    const feesXUsd = feesXHuman * priceX;
    const feesYUsd = feesYHuman * priceY;
    const protocolFeeXUsd = protocolFeeXHuman * priceX;
    const protocolFeeYUsd = protocolFeeYHuman * priceY;

    const totalWithdrawUsd = withdrawXUsd + withdrawYUsd;
    const totalFeesUsd = feesXUsd + feesYUsd;
    const totalProtocolFeeUsd = protocolFeeXUsd + protocolFeeYUsd;
    const netToUserUsd = totalWithdrawUsd - totalProtocolFeeUsd;

    pnl = {
      withdrawValue: {
        tokenX: { 
          amount: withdrawXHuman.toFixed(6).replace(/\.?0+$/, ''), 
          symbol: symbolX, 
          usd: Math.round(withdrawXUsd * 100) / 100 
        },
        tokenY: { 
          amount: withdrawYHuman.toFixed(6).replace(/\.?0+$/, ''), 
          symbol: symbolY, 
          usd: Math.round(withdrawYUsd * 100) / 100 
        },
        totalUsd: Math.round(totalWithdrawUsd * 100) / 100,
      },
      feesEarned: {
        tokenX: { 
          amount: feesXHuman.toFixed(6).replace(/\.?0+$/, ''), 
          symbol: symbolX, 
          usd: Math.round(feesXUsd * 100) / 100 
        },
        tokenY: { 
          amount: feesYHuman.toFixed(6).replace(/\.?0+$/, ''), 
          symbol: symbolY, 
          usd: Math.round(feesYUsd * 100) / 100 
        },
        totalUsd: Math.round(totalFeesUsd * 100) / 100,
        note: 'Lifetime fees from trading activity',
      },
      protocolFee: {
        tokenX: { 
          amount: protocolFeeXHuman.toFixed(6).replace(/\.?0+$/, ''), 
          usd: Math.round(protocolFeeXUsd * 100) / 100 
        },
        tokenY: { 
          amount: protocolFeeYHuman.toFixed(6).replace(/\.?0+$/, ''), 
          usd: Math.round(protocolFeeYUsd * 100) / 100 
        },
        totalUsd: Math.round(totalProtocolFeeUsd * 100) / 100,
        rate: '1%',
      },
      netToUser: {
        totalUsd: Math.round(netToUserUsd * 100) / 100,
      },
      summary: `💰 Withdrawing $${totalWithdrawUsd.toFixed(2)} | Earned $${totalFeesUsd.toFixed(2)} in fees | Net after 1% fee: $${netToUserUsd.toFixed(2)}`,
    };
  } catch (pnlError) {
    console.warn('[AtomicWithdraw] Failed to calculate PnL:', pnlError);
    // PnL will be undefined if price fetch fails
  }

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
    swap: params.convertToSol ? {
      enabled: true,
      inputAmount: swapDetails?.inputAmount,
      outputAmount: swapDetails?.outputAmount,
      route: swapDetails?.route,
      note: swapDetails ? 'All tokens will be converted to SOL' : 'Swap failed - tokens returned as-is',
    } : undefined,
    encryptedStrategy: {
      ciphertext: encrypted.ciphertext.slice(0, 32) + '...',
      nonce: encrypted.nonce,
    },
    pnl,
  };
}

export default { buildAtomicWithdraw };
