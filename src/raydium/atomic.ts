/**
 * Raydium CLMM Atomic LP Pipeline
 *
 * Builds swap + open position + add liquidity transactions.
 * Returns unsigned transactions for Privy MPC signing.
 */

import {
  PublicKey,
  VersionedTransaction,
  Connection,
  TransactionMessage,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ApiV3PoolInfoConcentratedItem,
  TickUtils,
  PoolUtils,
  ClmmKeys,
} from '@raydium-io/raydium-sdk-v2';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';
import { getRaydiumClient, getRaydiumConnection, TX_VERSION } from './client.js';
import { config } from '../config/index.js';
import { buildTipTransaction, type TipSpeed } from '../jito/index.js';

const JUPITER_API = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface RaydiumAtomicLPParams {
  walletAddress: string;
  poolAddress: string;
  amountSol: number;
  strategy: 'tight' | 'balanced' | 'wide';
  slippageBps?: number;
  tipSpeed?: TipSpeed;
  skipTip?: boolean;
}

export interface BuiltRaydiumLP {
  unsignedTransactions: string[];
  positionMint: string;
  tickRange: { lower: number; upper: number };
  encryptedStrategy?: any;
}

/**
 * Get Jupiter swap transaction
 */
async function getJupiterSwapTx(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  walletAddress: string;
}): Promise<string | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.jupiter?.apiKey) headers['x-api-key'] = config.jupiter.apiKey;

  // Get quote
  const quoteUrl = new URL(`${JUPITER_API}/quote`);
  quoteUrl.searchParams.set('inputMint', params.inputMint);
  quoteUrl.searchParams.set('outputMint', params.outputMint);
  quoteUrl.searchParams.set('amount', params.amount.toString());
  quoteUrl.searchParams.set('slippageBps', params.slippageBps.toString());
  // Exclude Raydium CLMM to avoid routing conflicts
  quoteUrl.searchParams.set('excludeDexes', 'Raydium CLMM');

  const quoteResp = await fetch(quoteUrl.toString(), { headers });
  if (!quoteResp.ok) {
    console.error('[Raydium] Jupiter quote failed:', await quoteResp.text());
    return null;
  }
  const quote = await quoteResp.json();

  // Get swap transaction
  const swapResp = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: params.walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
    }),
  });

  if (!swapResp.ok) {
    console.error('[Raydium] Jupiter swap failed:', await swapResp.text());
    return null;
  }

  const swapData = await swapResp.json() as { swapTransaction?: string };
  return swapData.swapTransaction || null;
}

/**
 * Build atomic LP transactions for Raydium CLMM
 */
export async function buildRaydiumAtomicLP(
  params: RaydiumAtomicLPParams
): Promise<BuiltRaydiumLP> {
  const {
    walletAddress,
    poolAddress,
    amountSol,
    strategy = 'balanced',
    slippageBps = 300,
    tipSpeed = 'medium',
    skipTip = false,
  } = params;

  const raydium = await getRaydiumClient();
  const connection = getRaydiumConnection();

  // Fetch pool info
  const poolData = await raydium.api.fetchPoolById({ ids: poolAddress });
  const poolInfo = poolData[0] as ApiV3PoolInfoConcentratedItem;

  if (!poolInfo) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }

  // Get on-chain price for accuracy
  const rpcData = await raydium.clmm.getRpcClmmPoolInfo({ poolId: poolAddress });
  const currentTick = rpcData.tickCurrent;

  // Calculate tick range based on strategy
  const tickSpacing = poolInfo.config.tickSpacing;
  let tickOffset: number;
  
  switch (strategy) {
    case 'tight':
      tickOffset = tickSpacing * 4; // ~±2% range
      break;
    case 'wide':
      tickOffset = tickSpacing * 50; // ~±15% range
      break;
    case 'balanced':
    default:
      tickOffset = tickSpacing * 16; // ~±5% range
      break;
  }

  // Align ticks to tick spacing
  const tickLower = Math.floor((currentTick - tickOffset) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((currentTick + tickOffset) / tickSpacing) * tickSpacing;

  // Determine which token is SOL and swap if needed
  const mintA = poolInfo.mintA.address;
  const mintB = poolInfo.mintB.address;
  const solIsMintA = mintA === SOL_MINT;
  const solIsMintB = mintB === SOL_MINT;
  
  const unsignedTransactions: string[] = [];

  // If pool doesn't contain SOL directly, we need to swap first
  if (!solIsMintA && !solIsMintB) {
    const targetMint = mintA;
    const swapAmount = Math.floor(amountSol * 1e9);
    
    const swapTxB64 = await getJupiterSwapTx({
      inputMint: SOL_MINT,
      outputMint: targetMint,
      amount: swapAmount,
      slippageBps,
      walletAddress,
    });
    
    if (swapTxB64) {
      unsignedTransactions.push(swapTxB64);
    } else {
      // No swap route means we can't get the pool tokens
      throw new Error(
        `Cannot LP into this pool: No swap route found for ${poolInfo.mintA.symbol || mintA.slice(0, 8)}. ` +
        `This pool doesn't contain SOL and Jupiter can't find a route. Try a SOL-paired pool instead.`
      );
    }
  }

  // Calculate amounts for LP
  const epochInfo = await raydium.fetchEpochInfo();
  const inputAmount = amountSol / 2;
  const decimals = solIsMintA ? poolInfo.mintA.decimals : poolInfo.mintB.decimals;
  const inputAmountBN = new BN(Math.floor(inputAmount * Math.pow(10, decimals)));

  const liquidityRes = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: slippageBps / 10000,
    inputA: solIsMintA,
    tickUpper,
    tickLower,
    amount: inputAmountBN,
    add: true,
    amountHasFee: true,
    epochInfo,
  });

  // Set the SDK owner to the actual wallet (required for token account lookups)
  const walletPubkey = new PublicKey(walletAddress);
  raydium.setOwner(walletPubkey);

  // Pre-create ATAs if they don't exist (Raydium SDK requires them)
  const ataInstructions: TransactionInstruction[] = [];
  const mintAPubkey = new PublicKey(mintA);
  const mintBPubkey = new PublicKey(mintB);
  
  // Check and create ATA for mintA (if not SOL)
  if (mintA !== SOL_MINT) {
    const ataA = getAssociatedTokenAddressSync(mintAPubkey, walletPubkey);
    const ataAInfo = await connection.getAccountInfo(ataA);
    if (!ataAInfo) {
      console.log(`[Raydium] Creating ATA for mintA: ${mintA}`);
      ataInstructions.push(
        createAssociatedTokenAccountInstruction(
          walletPubkey, // payer
          ataA,
          walletPubkey, // owner
          mintAPubkey
        )
      );
    }
  }
  
  // Check and create ATA for mintB (if not SOL)
  if (mintB !== SOL_MINT) {
    const ataB = getAssociatedTokenAddressSync(mintBPubkey, walletPubkey);
    const ataBInfo = await connection.getAccountInfo(ataB);
    if (!ataBInfo) {
      console.log(`[Raydium] Creating ATA for mintB: ${mintB}`);
      ataInstructions.push(
        createAssociatedTokenAccountInstruction(
          walletPubkey, // payer
          ataB,
          walletPubkey, // owner
          mintBPubkey
        )
      );
    }
  }
  
  // If we need to create ATAs, add that transaction first
  if (ataInstructions.length > 0) {
    const { blockhash: ataBlockhash } = await connection.getLatestBlockhash('finalized');
    const ataMessage = new TransactionMessage({
      payerKey: walletPubkey,
      recentBlockhash: ataBlockhash,
      instructions: ataInstructions,
    }).compileToV0Message();
    const ataTx = new VersionedTransaction(ataMessage);
    unsignedTransactions.push(Buffer.from(ataTx.serialize()).toString('base64'));
    console.log(`[Raydium] Added ATA creation tx with ${ataInstructions.length} instruction(s)`);
  }
  
  // Fetch token accounts for the wallet (populates SDK cache)
  await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true });

  // Build open position transaction
  const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    tickUpper,
    tickLower,
    base: solIsMintA ? 'MintA' : 'MintB',
    ownerInfo: {
      useSOLBalance: true,
    },
    baseAmount: inputAmountBN,
    otherAmountMax: liquidityRes.amountSlippageB.amount,
    txVersion: TX_VERSION,
    associatedOnly: false,
    checkCreateATAOwner: false,
    feePayer: walletPubkey,
    computeBudgetConfig: {
      units: 600000,
      microLamports: 100000,
    },
  });

  // Get the transaction bytes
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  
  // The SDK returns transactions via execute.buildUnsignedTxs or similar
  // For now, we'll use a workaround: build via execute but don't actually send
  try {
    const builtTxs = await (execute as any).buildUnsignedTxs?.();
    if (builtTxs && Array.isArray(builtTxs)) {
      for (const tx of builtTxs) {
        if (tx instanceof VersionedTransaction) {
          unsignedTransactions.push(Buffer.from(tx.serialize()).toString('base64'));
        }
      }
    }
  } catch {
    // Alternative: try to get transaction from execute directly
    console.warn('[Raydium] Could not build unsigned txs, position may not be created');
  }

  // Add Jito tip if not skipped
  if (!skipTip) {
    const { transaction: tipTx } = buildTipTransaction({
      payerAddress: walletAddress,
      recentBlockhash: blockhash,
      speed: tipSpeed,
    });
    unsignedTransactions.push(Buffer.from(tipTx.serialize()).toString('base64'));
  }

  return {
    unsignedTransactions,
    positionMint: extInfo.nftMint.toBase58(),
    tickRange: { lower: tickLower, upper: tickUpper },
  };
}

/**
 * Build withdraw transaction for Raydium CLMM
 */
export async function buildRaydiumWithdraw(params: {
  walletAddress: string;
  positionMint: string;
  closePosition?: boolean;
  slippageBps?: number;
  tipSpeed?: TipSpeed;
  skipTip?: boolean;
}): Promise<{ unsignedTransactions: string[] }> {
  const {
    walletAddress,
    positionMint,
    closePosition = true,
    tipSpeed = 'medium',
    skipTip = false,
  } = params;

  const raydium = await getRaydiumClient();
  const connection = getRaydiumConnection();

  // Set the SDK owner to the actual wallet (required for token account lookups)
  const walletPubkey = new PublicKey(walletAddress);
  raydium.setOwner(walletPubkey);
  await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true });

  // Get all owner positions
  const ownerPositions = await raydium.clmm.getOwnerPositionInfo({});
  
  // Find the specific position by NFT mint
  const positionData = ownerPositions.find(p => p.nftMint.toBase58() === positionMint);

  if (!positionData) {
    throw new Error(`Position not found: ${positionMint}`);
  }

  // Get pool info
  const poolData = await raydium.api.fetchPoolById({ ids: positionData.poolId.toBase58() });
  const poolInfo = poolData[0] as ApiV3PoolInfoConcentratedItem;

  if (!poolInfo) {
    throw new Error('Pool not found for position');
  }

  // Build decrease liquidity transaction (withdraw all)
  const { execute } = await raydium.clmm.decreaseLiquidity({
    poolInfo,
    ownerPosition: positionData,
    ownerInfo: {
      useSOLBalance: true,
    },
    liquidity: positionData.liquidity,
    amountMinA: new BN(0),
    amountMinB: new BN(0),
    txVersion: TX_VERSION,
    computeBudgetConfig: {
      units: 400000,
      microLamports: 100000,
    },
  });

  const unsignedTransactions: string[] = [];
  const { blockhash } = await connection.getLatestBlockhash('finalized');

  // Try to build unsigned transactions
  try {
    const builtTxs = await (execute as any).buildUnsignedTxs?.();
    if (builtTxs && Array.isArray(builtTxs)) {
      for (const tx of builtTxs) {
        if (tx instanceof VersionedTransaction) {
          unsignedTransactions.push(Buffer.from(tx.serialize()).toString('base64'));
        }
      }
    }
  } catch {
    console.warn('[Raydium] Could not build withdraw txs');
  }

  // Add Jito tip
  if (!skipTip) {
    const { transaction: tipTx } = buildTipTransaction({
      payerAddress: walletAddress,
      recentBlockhash: blockhash,
      speed: tipSpeed,
    });
    unsignedTransactions.push(Buffer.from(tipTx.serialize()).toString('base64'));
  }

  return { unsignedTransactions };
}

/**
 * Build claim fees transaction for Raydium CLMM
 */
export async function buildRaydiumClaimFees(params: {
  walletAddress: string;
  positionMint: string;
  tipSpeed?: TipSpeed;
  skipTip?: boolean;
}): Promise<{ unsignedTransactions: string[] }> {
  const {
    walletAddress,
    positionMint,
    tipSpeed = 'medium',
    skipTip = false,
  } = params;

  const raydium = await getRaydiumClient();
  const connection = getRaydiumConnection();

  // Set the SDK owner to the actual wallet (required for token account lookups)
  const walletPubkey = new PublicKey(walletAddress);
  raydium.setOwner(walletPubkey);
  await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true });

  // Get all owner positions
  const ownerPositions = await raydium.clmm.getOwnerPositionInfo({});
  
  // Find the specific position
  const positionData = ownerPositions.find(p => p.nftMint.toBase58() === positionMint);

  if (!positionData) {
    throw new Error(`Position not found: ${positionMint}`);
  }

  // Get pool info
  const poolData = await raydium.api.fetchPoolById({ ids: positionData.poolId.toBase58() });
  const poolInfo = poolData[0] as ApiV3PoolInfoConcentratedItem;

  // Build harvest (claim fees) transaction
  const { execute } = await raydium.clmm.harvestAllRewards({
    allPoolInfo: { [poolInfo.id]: poolInfo },
    allPositions: { [poolInfo.id]: [positionData] },
    ownerInfo: {
      useSOLBalance: true,
    },
    txVersion: TX_VERSION,
    computeBudgetConfig: {
      units: 300000,
      microLamports: 100000,
    },
  });

  const unsignedTransactions: string[] = [];
  const { blockhash } = await connection.getLatestBlockhash('finalized');

  // Try to build unsigned transactions
  try {
    const builtTxs = await (execute as any).buildUnsignedTxs?.();
    if (builtTxs && Array.isArray(builtTxs)) {
      for (const tx of builtTxs) {
        if (tx instanceof VersionedTransaction) {
          unsignedTransactions.push(Buffer.from(tx.serialize()).toString('base64'));
        }
      }
    }
  } catch {
    console.warn('[Raydium] Could not build claim txs');
  }

  // Add Jito tip
  if (!skipTip) {
    const { transaction: tipTx } = buildTipTransaction({
      payerAddress: walletAddress,
      recentBlockhash: blockhash,
      speed: tipSpeed,
    });
    unsignedTransactions.push(Buffer.from(tipTx.serialize()).toString('base64'));
  }

  return { unsignedTransactions };
}
