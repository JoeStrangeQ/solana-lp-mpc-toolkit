/**
 * Atomic LP Pipeline with Jito Bundling
 * 
 * Executes swap + LP in a single atomic transaction bundle.
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
import { buildTipTransaction, TipSpeed } from '../jito/index.js';
import { optimizeComputeBudget, buildComputeBudgetInstructions } from '../utils/priority-fees.js';
import { getCachedDLMM } from '../services/pool-cache.js';
import { getConnection } from '../services/connection-pool.js';

const JUPITER_API = 'https://api.jup.ag/swap/v1';

export interface AtomicLPParams {
  walletAddress: string;
  poolAddress: string;
  collateralMint: string;
  collateralAmount: number; // Amount in base units (lamports)
  strategy: 'concentrated' | 'wide' | 'custom';
  shape: 'spot' | 'curve' | 'bidask';
  minBinId?: number;
  maxBinId?: number;
  tipSpeed?: TipSpeed;
  slippageBps?: number; // Slippage in basis points (default: 300 = 3%)
  skipTip?: boolean; // Skip Jito tip tx (for direct RPC send)
}

export interface BuiltAtomicLP {
  unsignedTransactions: string[]; // Base64 encoded unsigned txs
  positionKeypair: string; // Secret key for the new position
  binRange: { min: number; max: number };
  encryptedStrategy?: any;
}

/**
 * Get Jupiter swap quote
 */
async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
  excludeDexes?: string[];
}): Promise<any> {
  const { inputMint, outputMint, amount, slippageBps = 100, excludeDexes } = params;
  
  const url = new URL(`${JUPITER_API}/quote`);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount.toString());
  url.searchParams.set('slippageBps', slippageBps.toString());
  
  // Exclude Meteora DLMM to avoid BitmapExtensionAccountIsNotProvided errors
  // This forces Jupiter to use other DEXes (Raydium, Orca, etc.) for swaps
  if (excludeDexes && excludeDexes.length > 0) {
    url.searchParams.set('excludeDexes', excludeDexes.join(','));
  }

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (config.jupiter?.apiKey) {
    headers['x-api-key'] = config.jupiter.apiKey;
  }
  
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) throw new Error(`Jupiter quote failed: ${await response.text()}`);
  return response.json();
}

/**
 * Get Jupiter swap transaction from quote
 */
async function getSwapTransaction(params: {
  quoteResponse: any;
  userPublicKey: string;
}): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.jupiter?.apiKey) {
    headers['x-api-key'] = config.jupiter.apiKey;
  }
  
  const response = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!response.ok) throw new Error(`Jupiter swap tx failed: ${await response.text()}`);
  const data = await response.json() as { swapTransaction: string };
  return data.swapTransaction;
}

/**
 * Main function to build the atomic LP bundle
 */
export async function buildAtomicLP(params: AtomicLPParams): Promise<BuiltAtomicLP> {
  const { walletAddress, poolAddress, collateralMint, collateralAmount, strategy, shape, minBinId, maxBinId, tipSpeed, slippageBps = 300, skipTip = false } = params;
  const connection = getConnection();
  
  // Convert bps to percentage for Meteora (300 bps = 3%)
  const meteoraSlippage = slippageBps / 100;

  // 1. Encrypt strategy (Arcium compatible)
  const encrypted = await arciumPrivacy.encryptStrategy({ intent: 'atomic_lp', pool: poolAddress, amount: collateralAmount });

  // 2. Get pool info (cached DLMM instance)
  const pool = await getCachedDLMM(connection, poolAddress);
  const [tokenXMint, tokenYMint] = [pool.tokenX.publicKey.toBase58(), pool.tokenY.publicKey.toBase58()];
  const [decimalsX, decimalsY] = [pool.tokenX.mint.decimals, pool.tokenY.mint.decimals];
  const halfCollateral = Math.floor(collateralAmount / 2);

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const unsignedTransactions: VersionedTransaction[] = [];

  // 3. Build swap transactions
  let amountXToLP = new BN(0);
  let amountYToLP = new BN(0);

  // Exclude Meteora DLMM from swap routes to avoid BitmapExtensionAccountIsNotProvided errors
  const excludeDexes = ['Meteora DLMM'];

  // Swap #1: Collateral -> TokenX
  if (collateralMint !== tokenXMint) {
    const quoteX = await getSwapQuote({ inputMint: collateralMint, outputMint: tokenXMint, amount: halfCollateral, slippageBps, excludeDexes });
    const swapTxX_b64 = await getSwapTransaction({ quoteResponse: quoteX, userPublicKey: walletAddress });
    unsignedTransactions.push(VersionedTransaction.deserialize(Buffer.from(swapTxX_b64, 'base64')));
    // Use minimum guaranteed output (after slippage) for LP amounts to avoid insufficient funds
    amountXToLP = new BN(quoteX.otherAmountThreshold || quoteX.outAmount);
  } else {
    amountXToLP = new BN(halfCollateral);
  }

  // Swap #2: Collateral -> TokenY
  if (collateralMint !== tokenYMint) {
    const quoteY = await getSwapQuote({ inputMint: collateralMint, outputMint: tokenYMint, amount: halfCollateral, slippageBps, excludeDexes });
    const swapTxY_b64 = await getSwapTransaction({ quoteResponse: quoteY, userPublicKey: walletAddress });
    unsignedTransactions.push(VersionedTransaction.deserialize(Buffer.from(swapTxY_b64, 'base64')));
    // Use minimum guaranteed output (after slippage) for LP amounts to avoid insufficient funds
    amountYToLP = new BN(quoteY.otherAmountThreshold || quoteY.outAmount);
  } else {
    amountYToLP = new BN(halfCollateral);
  }

  // 4. Build LP transaction
  const positionKeypair = Keypair.generate();
  const { binId: activeBinId } = await pool.getActiveBin();
  let minBin = strategy === 'wide' ? activeBinId - 20 : activeBinId - 5;
  let maxBin = strategy === 'wide' ? activeBinId + 20 : activeBinId + 5;
  if (strategy === 'custom' && minBinId && maxBinId) {
    minBin = activeBinId + minBinId;
    maxBin = activeBinId + maxBinId;
  }
  
  const strategyType = shape === 'curve' ? StrategyType.Curve : shape === 'bidask' ? StrategyType.BidAsk : StrategyType.Spot;

  const lpTxPayload = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    user: new PublicKey(walletAddress),
    totalXAmount: amountXToLP,
    totalYAmount: amountYToLP,
    strategy: { minBinId: minBin, maxBinId: maxBin, strategyType },
    slippage: meteoraSlippage, // Pass slippage to Meteora (e.g., 3 = 3%)
  });
  
  // Build initial tx with default CU to simulate, then optimize
  const lpInstructions = lpTxPayload.instructions.filter(
    (ix: any) => !ix.programId.equals(ComputeBudgetProgram.programId),
  );
  const defaultMsg = new TransactionMessage({
    payerKey: new PublicKey(walletAddress),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...lpInstructions,
    ],
  }).compileToV0Message();
  const tempTx = new VersionedTransaction(defaultMsg);

  // Simulate and estimate priority fees
  const budget = await optimizeComputeBudget(connection, tempTx, 'high');
  const budgetIxs = buildComputeBudgetInstructions(budget);

  const lpMsg = new TransactionMessage({
    payerKey: new PublicKey(walletAddress),
    recentBlockhash: blockhash,
    instructions: [...budgetIxs, ...lpInstructions],
  }).compileToV0Message();
  const lpTx = new VersionedTransaction(lpMsg);
  // PRE-SIGN with the position keypair, user will sign after
  lpTx.sign([positionKeypair]);
  unsignedTransactions.push(lpTx);

  // 5. Build Tip transaction (skip when sending directly via RPC)
  if (!skipTip) {
    const { transaction: tipTx } = buildTipTransaction({ payerAddress: walletAddress, recentBlockhash: blockhash, speed: tipSpeed });
    unsignedTransactions.push(tipTx);
  }

  return {
    unsignedTransactions: unsignedTransactions.map(tx => Buffer.from(tx.serialize()).toString('base64')),
    positionKeypair: Buffer.from(positionKeypair.secretKey).toString('base64'),
    binRange: { min: minBin, max: maxBin },
    encryptedStrategy: { ciphertext: encrypted.ciphertext.slice(0, 32) + '...' },
  };
}
