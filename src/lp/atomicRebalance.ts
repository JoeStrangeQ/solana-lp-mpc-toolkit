/**
 * Atomic Rebalance via Single Jito Bundle
 * 
 * Withdraw + Re-enter in ONE atomic bundle.
 * Either everything succeeds or nothing does.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  Transaction,
} from '@solana/web3.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { config } from '../config/index.js';
import { arciumPrivacy } from '../privacy/index.js';
import { buildTipTransaction, TipSpeed } from '../jito/index.js';
import { FEE_CONFIG, calculateFee } from '../fees/index.js';

export interface AtomicRebalanceParams {
  walletAddress: string;
  poolAddress: string;
  positionAddress: string;
  newMinBinOffset?: number;  // Offset from active bin (default: -5)
  newMaxBinOffset?: number;  // Offset from active bin (default: +5)
  strategy?: 'concentrated' | 'wide';
  shape?: 'spot' | 'curve' | 'bidask';
  tipSpeed?: TipSpeed;
  slippageBps?: number;
}

export interface BuiltAtomicRebalance {
  // All transactions in order - submit as ONE Jito bundle
  unsignedTransactions: string[];
  
  // New position keypair (for signing)
  newPositionKeypair: string;
  
  // Old position being closed
  oldPosition: {
    address: string;
    binRange: { lower: number; upper: number };
    amounts: { tokenX: string; tokenY: string };
  };
  
  // New position being created
  newPosition: {
    binRange: { lower: number; upper: number };
    priceRange: { lower: number; upper: number; display: string };
  };
  
  // Fee info
  fee: {
    bps: number;
    tokenX: string;
    tokenY: string;
  };
  
  // Privacy layer
  encryptedStrategy?: { ciphertext: string };
}

/**
 * Build atomic rebalance - all transactions for ONE Jito bundle
 * 
 * Transaction order:
 * 1. Compute budget (priority fee)
 * 2. Withdraw liquidity from old position
 * 3. Close old position
 * 4. Create new position
 * 5. Add liquidity to new position
 * 6. Jito tip
 */
export async function buildAtomicRebalance(params: AtomicRebalanceParams): Promise<BuiltAtomicRebalance> {
  const {
    walletAddress,
    poolAddress,
    positionAddress,
    newMinBinOffset = -5,
    newMaxBinOffset = 5,
    strategy = 'concentrated',
    shape = 'spot',
    tipSpeed = 'fast',
    slippageBps = 300,
  } = params;

  const connection = new Connection(config.solana.rpc);
  const walletPubkey = new PublicKey(walletAddress);

  console.log(`[AtomicRebalance] Building for position ${positionAddress}...`);

  // 1. Load pool and position
  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const activeBin = await pool.getActiveBin();
  
  // Find the position
  const { userPositions } = await pool.getPositionsByUserAndLbPair(walletPubkey);
  const position = userPositions.find(p => p.publicKey.toBase58() === positionAddress);
  
  if (!position) {
    throw new Error(`Position ${positionAddress} not found in pool ${poolAddress}`);
  }

  // Get position amounts
  const positionData = position.positionData;
  const lowerBinId = positionData.lowerBinId;
  const upperBinId = positionData.upperBinId;
  
  // Get total amounts from position data
  const totalXAmount = new BN(positionData.totalXAmount?.toString() || '0');
  const totalYAmount = new BN(positionData.totalYAmount?.toString() || '0');

  console.log(`[AtomicRebalance] Position has ${totalXAmount.toString()} tokenX, ${totalYAmount.toString()} tokenY`);

  // 2. Encrypt strategy with Arcium
  const encrypted = await arciumPrivacy.encryptStrategy({
    intent: 'atomic_rebalance',
    pool: poolAddress,
    binRange: [newMinBinOffset, newMaxBinOffset],
  });

  // 3. Calculate new bin range
  const newLowerBin = activeBin.binId + newMinBinOffset;
  const newUpperBin = activeBin.binId + newMaxBinOffset;
  
  // Calculate price range
  const binStep = pool.lbPair.binStep;
  const newLowerPrice = Math.pow(1 + binStep / 10000, newLowerBin);
  const newUpperPrice = Math.pow(1 + binStep / 10000, newUpperBin);

  // 4. Generate new position keypair
  const newPositionKp = Keypair.generate();

  // 5. Calculate protocol fee (1%)
  const feeXCalc = calculateFee(totalXAmount.toNumber());
  const feeYCalc = calculateFee(totalYAmount.toNumber());
  const netX = new BN(feeXCalc.netAmount);
  const netY = new BN(feeYCalc.netAmount);

  // 6. Build all transactions
  const allTransactions: VersionedTransaction[] = [];
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // === Transaction 1: Withdraw + Close old position ===
  const withdrawTx = await pool.removeLiquidity({
    position: position.publicKey,
    user: walletPubkey,
    fromBinId: lowerBinId,
    toBinId: upperBinId,
    bps: new BN(10000), // 100% - withdraw everything
    shouldClaimAndClose: true,
  });

  // Handle Meteora SDK response (can be Transaction or Transaction[])
  const withdrawTxs = Array.isArray(withdrawTx) ? withdrawTx : [withdrawTx];
  
  for (const tx of withdrawTxs) {
    const vtx = convertToVersionedTx(tx, walletPubkey, blockhash);
    allTransactions.push(vtx);
  }

  // === Transaction 2: Create new position + Add liquidity ===
  // Determine strategy type
  let strategyType: StrategyType;
  if (shape === 'curve') {
    strategyType = StrategyType.Curve;
  } else if (shape === 'bidask') {
    strategyType = StrategyType.BidAsk;
  } else {
    strategyType = StrategyType.Spot;
  }

  // Create new position transaction
  const createPositionTx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: newPositionKp.publicKey,
    user: walletPubkey,
    totalXAmount: netX, // After fee
    totalYAmount: netY, // After fee
    strategy: {
      minBinId: newLowerBin,
      maxBinId: newUpperBin,
      strategyType,
    },
    slippage: slippageBps / 100, // Convert bps to percentage
  });

  // Handle if it returns multiple transactions
  const lpTxs = Array.isArray(createPositionTx) ? createPositionTx : [createPositionTx];
  
  for (const tx of lpTxs) {
    const vtx = convertToVersionedTx(tx, walletPubkey, blockhash);
    vtx.sign([newPositionKp]); // Sign with new position keypair
    allTransactions.push(vtx);
  }

  // === Transaction 3: Jito tip ===
  const { transaction: tipTx } = buildTipTransaction({
    payerAddress: walletAddress,
    recentBlockhash: blockhash,
    speed: tipSpeed,
  });
  allTransactions.push(tipTx);

  // 7. Serialize all transactions
  const unsignedTransactions = allTransactions.map(tx => 
    Buffer.from(tx.serialize()).toString('base64')
  );

  console.log(`[AtomicRebalance] Built ${unsignedTransactions.length} transactions for atomic bundle`);

  return {
    unsignedTransactions,
    newPositionKeypair: Buffer.from(newPositionKp.secretKey).toString('base64'),
    oldPosition: {
      address: positionAddress,
      binRange: { lower: lowerBinId, upper: upperBinId },
      amounts: { tokenX: totalXAmount.toString(), tokenY: totalYAmount.toString() },
    },
    newPosition: {
      binRange: { lower: newLowerBin, upper: newUpperBin },
      priceRange: {
        lower: newLowerPrice,
        upper: newUpperPrice,
        display: `${newLowerPrice.toFixed(6)} - ${newUpperPrice.toFixed(6)}`,
      },
    },
    fee: {
      bps: FEE_CONFIG.FEE_BPS,
      tokenX: feeXCalc.feeAmount.toString(),
      tokenY: feeYCalc.feeAmount.toString(),
    },
    encryptedStrategy: encrypted,
  };
}

/**
 * Convert a Meteora SDK transaction to VersionedTransaction
 */
function convertToVersionedTx(
  tx: Transaction | VersionedTransaction | any,
  payer: PublicKey,
  blockhash: string
): VersionedTransaction {
  // Add compute budget to all transactions
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
  const priceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 });
  
  if (tx instanceof VersionedTransaction) {
    return tx;
  }
  
  if ('instructions' in tx && Array.isArray(tx.instructions)) {
    // It's a Transaction-like object with instructions
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [computeIx, priceIx, ...tx.instructions],
    }).compileToV0Message();
    
    return new VersionedTransaction(message);
  }
  
  if ('recentBlockhash' in tx) {
    // Legacy Transaction
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
    
    // Prepend compute budget instructions
    const instructions = [computeIx, priceIx, ...tx.instructions];
    
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    
    return new VersionedTransaction(message);
  }
  
  throw new Error('Unknown transaction format from Meteora SDK');
}
