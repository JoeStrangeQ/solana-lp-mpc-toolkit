/**
 * Atomic LP Pipeline with Jito Bundling
 * 
 * Executes swap + LP in a single atomic transaction bundle.
 * Either all succeed or all fail - no partial execution.
 * 
 * Compatible with Arcium encryption - strategy is encrypted before
 * transaction building.
 */

import { 
  Connection, 
  PublicKey, 
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { config } from '../config/index.js';
import { arciumPrivacy } from '../privacy/index.js';
import { buildTipTransaction, sendBundle, waitForBundle, TipSpeed } from '../jito/index.js';

const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1';
const JUPITER_QUOTE_API = 'https://api.jup.ag/quote/v6';

export interface AtomicLPParams {
  walletAddress: string;
  poolAddress: string;
  collateralMint: string;  // Token to swap FROM (usually SOL)
  collateralAmount: number; // Amount in base units (lamports)
  collateralDecimals: number;
  strategy: 'concentrated' | 'wide' | 'custom';
  shape: 'spot' | 'curve' | 'bidask';
  minBinId?: number; // For custom strategy
  maxBinId?: number;
  tipSpeed?: TipSpeed;
  signTransaction: (tx: string) => Promise<string>;
}

export interface AtomicLPResult {
  success: boolean;
  message: string;
  bundleId?: string;
  positionAddress?: string;
  swapTxIds?: string[];
  lpTxId?: string;
  tipTxId?: string;
  encryptedStrategy?: {
    ciphertext: string;
    nonce: string;
    mxeCluster: number;
  };
  error?: string;
}

/**
 * Get Jupiter swap quote
 */
async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
}): Promise<any> {
  const { inputMint, outputMint, amount, slippageBps = 50 } = params;
  
  const url = new URL(JUPITER_QUOTE_API);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount.toString());
  url.searchParams.set('slippageBps', slippageBps.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Jupiter quote failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Build Jupiter swap transaction
 */
async function buildSwapTransaction(params: {
  quoteResponse: any;
  userPublicKey: string;
}): Promise<string> {
  const { quoteResponse, userPublicKey } = params;

  const response = await fetch(`${JUPITER_SWAP_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jupiter swap failed: ${response.status} - ${text}`);
  }

  const data = await response.json() as { swapTransaction: string };
  return data.swapTransaction;
}

/**
 * Build DLMM add liquidity transaction
 */
async function buildLPTransaction(params: {
  connection: Connection;
  poolAddress: string;
  userAddress: string;
  amountX: BN;
  amountY: BN;
  strategy: 'concentrated' | 'wide' | 'custom';
  shape: 'spot' | 'curve' | 'bidask';
  minBinId?: number;
  maxBinId?: number;
  recentBlockhash: string;
}): Promise<{ transaction: VersionedTransaction; positionKeypair: Keypair; binRange: { min: number; max: number } }> {
  const { connection, poolAddress, userAddress, amountX, amountY, strategy, shape, minBinId, maxBinId, recentBlockhash } = params;

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const activeBin = await pool.getActiveBin();
  const positionKeypair = Keypair.generate();

  // Calculate bin range
  let minBin: number;
  let maxBin: number;

  if (strategy === 'custom' && minBinId !== undefined && maxBinId !== undefined) {
    minBin = activeBin.binId + minBinId;
    maxBin = activeBin.binId + maxBinId;
  } else if (strategy === 'wide') {
    minBin = activeBin.binId - 20;
    maxBin = activeBin.binId + 20;
  } else {
    // concentrated
    minBin = activeBin.binId - 5;
    maxBin = activeBin.binId + 5;
  }

  // Map shape to StrategyType
  let strategyType: StrategyType;
  switch (shape) {
    case 'curve': strategyType = StrategyType.Curve; break;
    case 'bidask': strategyType = StrategyType.BidAsk; break;
    default: strategyType = StrategyType.Spot; break;
  }

  // Build the transaction
  const createPositionTx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    user: new PublicKey(userAddress),
    totalXAmount: amountX,
    totalYAmount: amountY,
    strategy: {
      minBinId: minBin,
      maxBinId: maxBin,
      strategyType,
    },
    slippage: 100, // 1%
  });

  // Extract instructions and rebuild without Meteora's compute budget
  const instructions = createPositionTx.instructions.filter(ix => 
    !ix.programId.equals(ComputeBudgetProgram.programId)
  );

  // Add our own compute budget
  const cuInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
  ];

  const message = new TransactionMessage({
    payerKey: new PublicKey(userAddress),
    recentBlockhash,
    instructions: [...cuInstructions, ...instructions],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([positionKeypair]);

  return {
    transaction: tx,
    positionKeypair,
    binRange: { min: minBin, max: maxBin },
  };
}

/**
 * Execute atomic swap + LP via Jito bundle
 * 
 * Flow:
 * 1. Encrypt strategy with Arcium (privacy)
 * 2. Get pool info and calculate amounts
 * 3. Get swap quotes (collateral → tokenX, tokenY)
 * 4. Build swap transactions
 * 5. Build LP transaction
 * 6. Build tip transaction
 * 7. Bundle all transactions
 * 8. Sign and send via Jito
 * 9. Wait for bundle to land
 */
export async function executeAtomicLP(params: AtomicLPParams): Promise<AtomicLPResult> {
  const {
    walletAddress,
    poolAddress,
    collateralMint,
    collateralAmount,
    collateralDecimals,
    strategy,
    shape,
    minBinId,
    maxBinId,
    tipSpeed = 'fast',
    signTransaction,
  } = params;

  const connection = new Connection(config.solana.rpc);

  try {
    // 1. Encrypt strategy with Arcium (for privacy)
    let encryptedStrategy;
    try {
      await arciumPrivacy.initialize();
      const encrypted = await arciumPrivacy.encryptStrategy({
        intent: 'atomic_lp',
        pool: poolAddress,
        amount: collateralAmount / Math.pow(10, collateralDecimals),
        distribution: shape === 'curve' ? 'gaussian' : shape === 'bidask' ? 'bid-heavy' : 'uniform',
      });
      encryptedStrategy = {
        ciphertext: encrypted.ciphertext.slice(0, 32) + '...',
        nonce: encrypted.nonce,
        mxeCluster: encrypted.mxeCluster ?? 456,
      };
      console.log('[AtomicLP] Strategy encrypted with Arcium');
    } catch (e) {
      console.warn('[AtomicLP] Arcium encryption skipped:', (e as Error).message);
    }

    // 2. Get pool info
    const pool = await DLMM.create(connection, new PublicKey(poolAddress));
    const activeBin = await pool.getActiveBin();
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const tokenYMint = pool.tokenY.publicKey.toBase58();
    const decimalsX = pool.tokenX.mint.decimals;
    const decimalsY = pool.tokenY.mint.decimals;

    console.log(`[AtomicLP] Pool: ${poolAddress}`);
    console.log(`[AtomicLP] TokenX: ${tokenXMint} (${decimalsX}d), TokenY: ${tokenYMint} (${decimalsY}d)`);

    // 3. Get USD prices to calculate split
    const priceUrl = `https://api.jup.ag/price/v2?ids=${tokenXMint},${tokenYMint},${collateralMint}`;
    const priceResp = await fetch(priceUrl);
    const priceData = await priceResp.json() as { data: Record<string, { price: string }> };
    
    const priceX = parseFloat(priceData.data[tokenXMint]?.price || '1');
    const priceY = parseFloat(priceData.data[tokenYMint]?.price || '1');
    const priceCollateral = parseFloat(priceData.data[collateralMint]?.price || '1');

    // Calculate USD value and split 50/50
    const collateralUsd = (collateralAmount / Math.pow(10, collateralDecimals)) * priceCollateral;
    const halfUsd = collateralUsd / 2;
    
    const targetAmountX = Math.floor((halfUsd / priceX) * Math.pow(10, decimalsX));
    const targetAmountY = Math.floor((halfUsd / priceY) * Math.pow(10, decimalsY));
    const halfCollateral = Math.floor(collateralAmount / 2);

    console.log(`[AtomicLP] Collateral: ${collateralUsd.toFixed(2)} USD`);
    console.log(`[AtomicLP] Target X: ${targetAmountX} (${halfUsd.toFixed(2)} USD)`);
    console.log(`[AtomicLP] Target Y: ${targetAmountY} (${halfUsd.toFixed(2)} USD)`);

    // 4. Get blockhash (shared across all transactions)
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // 5. Build swap transactions (if collateral != pool tokens)
    const swapTransactions: string[] = [];
    const swapTxIds: string[] = [];

    // Check if we need to swap for tokenX
    if (collateralMint !== tokenXMint) {
      console.log(`[AtomicLP] Getting swap quote: ${collateralMint} → ${tokenXMint}`);
      const quoteX = await getSwapQuote({
        inputMint: collateralMint,
        outputMint: tokenXMint,
        amount: halfCollateral,
      });
      const swapTxX = await buildSwapTransaction({
        quoteResponse: quoteX,
        userPublicKey: walletAddress,
      });
      swapTransactions.push(swapTxX);
    }

    // Check if we need to swap for tokenY
    if (collateralMint !== tokenYMint) {
      console.log(`[AtomicLP] Getting swap quote: ${collateralMint} → ${tokenYMint}`);
      const quoteY = await getSwapQuote({
        inputMint: collateralMint,
        outputMint: tokenYMint,
        amount: halfCollateral,
      });
      const swapTxY = await buildSwapTransaction({
        quoteResponse: quoteY,
        userPublicKey: walletAddress,
      });
      swapTransactions.push(swapTxY);
    }

    // 6. Build LP transaction
    const { transaction: lpTx, positionKeypair, binRange } = await buildLPTransaction({
      connection,
      poolAddress,
      userAddress: walletAddress,
      amountX: new BN(targetAmountX),
      amountY: new BN(targetAmountY),
      strategy,
      shape,
      minBinId,
      maxBinId,
      recentBlockhash: blockhash,
    });

    // 7. Build tip transaction
    const { transaction: tipTx, tipLamports } = buildTipTransaction({
      payerAddress: walletAddress,
      recentBlockhash: blockhash,
      speed: tipSpeed,
    });

    console.log(`[AtomicLP] Jito tip: ${tipLamports / 1e9} SOL`);

    // 8. Sign all transactions
    const signedTransactions: string[] = [];

    // Sign swap transactions
    for (const swapTx of swapTransactions) {
      const signed = await signTransaction(swapTx);
      signedTransactions.push(signed);
    }

    // Sign LP transaction (position keypair already signed)
    const lpTxBase64 = Buffer.from(lpTx.serialize()).toString('base64');
    const signedLpTx = await signTransaction(lpTxBase64);
    signedTransactions.push(signedLpTx);

    // Sign tip transaction
    const tipTxBase64 = Buffer.from(tipTx.serialize()).toString('base64');
    const signedTipTx = await signTransaction(tipTxBase64);
    signedTransactions.push(signedTipTx);

    console.log(`[AtomicLP] Sending Jito bundle with ${signedTransactions.length} transactions`);

    // 9. Send bundle via Jito
    const { bundleId } = await sendBundle(signedTransactions);
    console.log(`[AtomicLP] Bundle submitted: ${bundleId}`);

    // 10. Wait for bundle to land
    const result = await waitForBundle(bundleId, { timeoutMs: 30000 });

    if (!result.landed) {
      return {
        success: false,
        message: `Bundle failed to land: ${result.error}`,
        bundleId,
        error: result.error,
        encryptedStrategy,
      };
    }

    return {
      success: true,
      message: `Atomic LP executed! Bundle landed in slot ${result.slot}`,
      bundleId,
      positionAddress: positionKeypair.publicKey.toBase58(),
      swapTxIds: swapTxIds,
      encryptedStrategy,
    };

  } catch (error) {
    console.error('[AtomicLP] Error:', error);
    return {
      success: false,
      message: 'Atomic LP failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  executeAtomicLP,
};
