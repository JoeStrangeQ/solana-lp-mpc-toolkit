/**
 * Orca Whirlpool Atomic LP Pipeline
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
import { getWhirlpoolClient, getOrcaConnection } from './client.js';
import {
  increaseLiquidityQuoteByInputTokenWithParams,
  TickUtil,
  TokenExtensionUtil,
} from '@orca-so/whirlpools-sdk';
import { Percentage } from '@orca-so/common-sdk';
import BN from 'bn.js';
import { config } from '../config/index.js';
import { buildTipTransaction, type TipSpeed } from '../jito/index.js';
import { optimizeComputeBudget, buildComputeBudgetInstructions } from '../utils/priority-fees.js';
import { arciumPrivacy } from '../privacy/index.js';

const JUPITER_API = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface OrcaAtomicLPParams {
  walletAddress: string;
  poolAddress: string;
  amountSol: number;
  strategy: 'concentrated' | 'wide';
  slippageBps?: number;
  tipSpeed?: TipSpeed;
  skipTip?: boolean;
}

export interface BuiltOrcaLP {
  unsignedTransactions: string[];
  positionMint: string;
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

export async function buildOrcaAtomicLP(params: OrcaAtomicLPParams): Promise<BuiltOrcaLP> {
  const {
    walletAddress,
    poolAddress,
    amountSol,
    strategy,
    slippageBps = 300,
    tipSpeed,
    skipTip = false,
  } = params;

  const connection = getOrcaConnection();
  const client = getWhirlpoolClient(connection);

  // 0. Encrypt strategy with Arcium before execution
  const encrypted = await arciumPrivacy.encryptStrategy({
    intent: 'orca_atomic_lp',
    pool: poolAddress,
    amount: Math.floor(amountSol * 1e9),
    strategy,
  });
  console.log(`[Orca Atomic] Strategy encrypted: ${encrypted.ciphertext.slice(0, 20)}...`);

  // 1. Get pool data
  const pool = await client.getPool(new PublicKey(poolAddress));
  const poolData = pool.getData();
  const tokenAInfo = pool.getTokenAInfo();
  const tokenBInfo = pool.getTokenBInfo();
  const tickSpacing = poolData.tickSpacing;
  const currentTick = poolData.tickCurrentIndex;

  // 2. Calculate tick range based on strategy
  const tickOffset = strategy === 'concentrated' ? 5 * tickSpacing : 20 * tickSpacing;
  const lowerTick = TickUtil.getInitializableTickIndex(currentTick - tickOffset, tickSpacing);
  const upperTick = TickUtil.getInitializableTickIndex(currentTick + tickOffset, tickSpacing);

  // 3. Get blockhash
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const unsignedTransactions: string[] = [];
  const lamports = Math.floor(amountSol * 1e9);
  const halfLamports = Math.floor(lamports / 2);

  const tokenAMint = tokenAInfo.mint.toBase58();
  const tokenBMint = tokenBInfo.mint.toBase58();

  // 4. Build swap transactions if needed (SOL -> tokenA, SOL -> tokenB)
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

  // 5. Build liquidity quote
  const slippage = Percentage.fromFraction(slippageBps, 10000);
  const inputTokenMint =
    tokenAMint === SOL_MINT ? tokenAInfo.mint : tokenBInfo.mint;
  const inputAmount = new BN(halfLamports);

  const fetcher = client.getFetcher();
  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContextForPool(
    fetcher, tokenAInfo.mint, tokenBInfo.mint,
  );

  const liquidityQuote = increaseLiquidityQuoteByInputTokenWithParams({
    tokenMintA: tokenAInfo.mint,
    tokenMintB: tokenBInfo.mint,
    sqrtPrice: poolData.sqrtPrice,
    tickCurrentIndex: currentTick,
    tickLowerIndex: lowerTick,
    tickUpperIndex: upperTick,
    inputTokenMint,
    inputTokenAmount: inputAmount,
    slippageTolerance: slippage,
    tokenExtensionCtx,
  });

  // 6. Build open position + add liquidity via SDK
  // openPosition takes IncreaseLiquidityInput as 3rd arg (combined open+addLiq)
  const { positionMint, tx: openPosTxBuilder } = await pool.openPosition(
    lowerTick,
    upperTick,
    liquidityQuote,
    walletAddress,  // wallet (owner)
    walletAddress,  // funder
  );

  // Initialize tick arrays if needed (may return null if already initialized)
  const initTickArrayTx = await pool.initTickArrayForTicks(
    [lowerTick, upperTick],
    walletAddress,
  );

  // 7. Build and serialize the transactions
  // Init tick arrays first if needed
  if (initTickArrayTx) {
    const initPayload = await initTickArrayTx.build();
    const initTx = initPayload.transaction;
    if (initTx instanceof VersionedTransaction) {
      unsignedTransactions.push(
        Buffer.from(initTx.serialize()).toString('base64'),
      );
    } else {
      // Legacy transaction - set blockhash and serialize
      initTx.recentBlockhash = blockhash;
      initTx.feePayer = new PublicKey(walletAddress);
      const serialized = initTx.serialize({ requireAllSignatures: false });
      unsignedTransactions.push(serialized.toString('base64'));
    }
  }

  // Open position + add liquidity
  const openPayload = await openPosTxBuilder.build();
  const openTx = openPayload.transaction;

  // Optimize compute budget via simulation + dynamic priority fees
  if (openTx instanceof VersionedTransaction) {
    // Simulate and estimate optimal CU + priority fee
    const budget = await optimizeComputeBudget(connection, openTx, 'high');
    const budgetIxs = buildComputeBudgetInstructions(budget);
    // Decompose the message to rebuild with optimized compute budget
    const decompiledMsg = TransactionMessage.decompile(openTx.message);
    const filteredIxs = decompiledMsg.instructions.filter(
      (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
    );
    const newMsg = new TransactionMessage({
      payerKey: decompiledMsg.payerKey,
      recentBlockhash: decompiledMsg.recentBlockhash,
      instructions: [...budgetIxs, ...filteredIxs],
    }).compileToV0Message();
    const newTx = new VersionedTransaction(newMsg);
    if (openPayload.signers.length > 0) {
      newTx.sign(openPayload.signers);
    }
    unsignedTransactions.push(
      Buffer.from(newTx.serialize()).toString('base64'),
    );
  } else {
    // Legacy Transaction: convert to versioned for simulation, then apply budget
    const tempVersioned = new VersionedTransaction(
      new TransactionMessage({
        payerKey: new PublicKey(walletAddress),
        recentBlockhash: blockhash,
        instructions: openTx.instructions,
      }).compileToV0Message(),
    );
    const budget = await optimizeComputeBudget(connection, tempVersioned, 'high');
    const budgetIxs = buildComputeBudgetInstructions(budget);
    const filtered = openTx.instructions.filter(
      (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
    );
    openTx.instructions = [...budgetIxs, ...filtered];
    openTx.recentBlockhash = blockhash;
    openTx.feePayer = new PublicKey(walletAddress);
    if (openPayload.signers.length > 0) {
      openTx.partialSign(...openPayload.signers);
    }
    const serialized = openTx.serialize({ requireAllSignatures: false });
    unsignedTransactions.push(serialized.toString('base64'));
  }

  // 8. Add Jito tip if needed
  if (!skipTip) {
    const { transaction: tipTx } = buildTipTransaction({
      payerAddress: walletAddress,
      recentBlockhash: blockhash,
      speed: tipSpeed,
    });
    unsignedTransactions.push(
      Buffer.from(tipTx.serialize()).toString('base64'),
    );
  }

  return {
    unsignedTransactions,
    positionMint: positionMint.toBase58(),
    tickRange: { lower: lowerTick, upper: upperTick },
  };
}
