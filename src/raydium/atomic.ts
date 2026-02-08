/**
 * Raydium CLMM Atomic LP Pipeline
 *
 * Builds swap + open position + add liquidity transactions.
 * Transactions are unsigned base64 strings for Privy MPC signing.
 */

import {
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  Raydium,
  TxVersion,
  ApiV3PoolInfoConcentratedItem,
  TickUtils,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import { config } from '../config/index.js';
import { buildTipTransaction, type TipSpeed } from '../jito/index.js';
import { optimizeComputeBudget, buildComputeBudgetInstructions } from '../utils/priority-fees.js';
import { arciumPrivacy } from '../privacy/index.js';

const JUPITER_API = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface RaydiumAtomicLPParams {
  walletAddress: string;
  poolAddress: string;
  amountSol: number;
  strategy: 'concentrated' | 'wide';
  slippageBps?: number;
  tipSpeed?: TipSpeed;
  skipTip?: boolean;
}

export interface BuiltRaydiumLP {
  unsignedTransactions: string[];
  positionNftMint: string;
  tickRange: { lower: number; upper: number };
}

async function getJupiterSwapTx(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  walletAddress: string;
}): Promise<string | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.jupiter?.apiKey) headers['x-api-key'] = config.jupiter.apiKey;

  const quoteUrl = new URL(`${JUPITER_API}/quote`);
  quoteUrl.searchParams.set('inputMint', params.inputMint);
  quoteUrl.searchParams.set('outputMint', params.outputMint);
  quoteUrl.searchParams.set('amount', params.amount.toString());
  quoteUrl.searchParams.set('slippageBps', params.slippageBps.toString());

  const quoteResp = await fetch(quoteUrl.toString(), { headers });
  if (!quoteResp.ok) return null;
  const quote = await quoteResp.json();

  const swapHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.jupiter?.apiKey) swapHeaders['x-api-key'] = config.jupiter.apiKey;

  const swapResp = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: swapHeaders,
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: params.walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!swapResp.ok) return null;
  const swapData = (await swapResp.json()) as { swapTransaction: string };
  return swapData.swapTransaction;
}

export async function buildRaydiumAtomicLP(
  connection: import('@solana/web3.js').Connection,
  params: RaydiumAtomicLPParams,
): Promise<BuiltRaydiumLP> {
  const {
    walletAddress,
    poolAddress,
    amountSol,
    strategy,
    slippageBps = 300,
    tipSpeed,
    skipTip = false,
  } = params;

  // 0. Encrypt strategy with Arcium before execution
  const encrypted = await arciumPrivacy.encryptStrategy({
    intent: 'raydium_atomic_lp',
    pool: poolAddress,
    amount: Math.floor(amountSol * 1e9),
    strategy,
  });
  console.log(`[Raydium Atomic] Strategy encrypted: ${encrypted.ciphertext.slice(0, 20)}...`);

  // 1. Initialize Raydium SDK
  const owner = new PublicKey(walletAddress);
  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
  });

  // 2. Fetch pool info
  const poolInfoList = await raydium.api.fetchPoolById({ ids: poolAddress });
  if (!poolInfoList.length) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }
  const poolInfo = poolInfoList[0] as ApiV3PoolInfoConcentratedItem;
  
  if (poolInfo.type !== 'Concentrated') {
    throw new Error(`Pool ${poolAddress} is not a CLMM pool`);
  }

  // 3. Get current tick and calculate range based on strategy
  const poolRpcData = await raydium.clmm.getRpcClmmPoolInfo({ poolId: poolAddress });
  const currentTick = poolRpcData.tickCurrent;
  const tickSpacing = poolInfo.config.tickSpacing;

  // Calculate tick range
  const tickOffset = strategy === 'concentrated' ? 5 * tickSpacing : 20 * tickSpacing;
  const tickLower = Math.floor((currentTick - tickOffset) / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor((currentTick + tickOffset) / tickSpacing) * tickSpacing;

  // 4. Build transactions
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const unsignedTransactions: string[] = [];
  const lamports = Math.floor(amountSol * 1e9);
  const halfLamports = Math.floor(lamports / 2);

  const tokenAMint = poolInfo.mintA.address;
  const tokenBMint = poolInfo.mintB.address;

  // 5. Build swap transactions if needed (SOL -> tokenA, SOL -> tokenB)
  if (tokenAMint !== SOL_MINT) {
    const swapTx = await getJupiterSwapTx({
      inputMint: SOL_MINT,
      outputMint: tokenAMint,
      amount: halfLamports,
      slippageBps,
      walletAddress,
    });
    if (swapTx) unsignedTransactions.push(swapTx);
  }

  if (tokenBMint !== SOL_MINT) {
    const swapTx = await getJupiterSwapTx({
      inputMint: SOL_MINT,
      outputMint: tokenBMint,
      amount: halfLamports,
      slippageBps,
      walletAddress,
    });
    if (swapTx) unsignedTransactions.push(swapTx);
  }

  // 6. Build open position transaction using Raydium SDK
  const epochInfo = await connection.getEpochInfo();
  const slippage = slippageBps / 10000; // Convert bps to decimal

  // Determine which token to use as base for liquidity calculation
  const baseIn = true; // Use tokenA as base
  const inputAmount = new BN(halfLamports);

  const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    ownerInfo: {
      useSOLBalance: true,
    },
    tickLower,
    tickUpper,
    base: 'MintA',
    baseAmount: inputAmount,
    otherAmountMax: inputAmount.muln(2), // Allow for slippage
    txVersion: TxVersion.V0,
  });

  const positionNftMint = extInfo.nftMint.toBase58();

  // Get the transaction from the execute result
  const { transactions } = await execute({ sendAndConfirm: false });
  
  for (const tx of transactions) {
    if (tx.transaction instanceof VersionedTransaction) {
      // Optimize compute budget
      const budget = await optimizeComputeBudget(connection, tx.transaction, 'high');
      const budgetIxs = buildComputeBudgetInstructions(budget);
      
      // Decompose and rebuild with optimized budget
      const decompiledMsg = TransactionMessage.decompile(tx.transaction.message);
      const filteredIxs = decompiledMsg.instructions.filter(
        (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
      );
      const newMsg = new TransactionMessage({
        payerKey: decompiledMsg.payerKey,
        recentBlockhash: blockhash,
        instructions: [...budgetIxs, ...filteredIxs],
      }).compileToV0Message();
      
      const newTx = new VersionedTransaction(newMsg);
      if (tx.signers?.length) {
        newTx.sign(tx.signers);
      }
      unsignedTransactions.push(Buffer.from(newTx.serialize()).toString('base64'));
    }
  }

  // 7. Add Jito tip if needed
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
    positionNftMint,
    tickRange: { lower: tickLower, upper: tickUpper },
  };
}

/**
 * Build add liquidity transaction for an existing position
 */
export async function buildRaydiumAddLiquidity(
  connection: import('@solana/web3.js').Connection,
  params: {
    walletAddress: string;
    poolAddress: string;
    positionNftMint: string;
    amountA: BN;
    amountB: BN;
    slippageBps?: number;
  },
): Promise<{ unsignedTransaction: string }> {
  const { walletAddress, poolAddress, positionNftMint, amountA, amountB, slippageBps = 300 } = params;

  const owner = new PublicKey(walletAddress);
  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
  });

  // Fetch pool and position info
  const poolInfoList = await raydium.api.fetchPoolById({ ids: poolAddress });
  if (!poolInfoList.length) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }
  const poolInfo = poolInfoList[0] as ApiV3PoolInfoConcentratedItem;

  // Get position data
  const positions = await raydium.clmm.getOwnerPositionInfo({});
  const position = positions.find(p => p.nftMint.toBase58() === positionNftMint);
  if (!position) {
    throw new Error(`Position not found: ${positionNftMint}`);
  }

  const { execute } = await raydium.clmm.increasePositionFromBase({
    poolInfo,
    ownerPosition: position,
    ownerInfo: {
      useSOLBalance: true,
    },
    base: 'MintA',
    baseAmount: amountA,
    otherAmountMax: amountB.muln(2), // Allow slippage
    txVersion: TxVersion.V0,
  });

  const { transactions } = await execute({ sendAndConfirm: false });
  
  if (!transactions.length || !(transactions[0].transaction instanceof VersionedTransaction)) {
    throw new Error('Failed to build increase liquidity transaction');
  }

  return {
    unsignedTransaction: Buffer.from(transactions[0].transaction.serialize()).toString('base64'),
  };
}
