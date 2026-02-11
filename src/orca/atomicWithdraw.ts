/**
 * Orca Whirlpool Withdraw Pipeline
 *
 * Builds decrease liquidity + collect fees + close position transactions.
 * Uses the SDK's closePosition which handles all three steps.
 */

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getWhirlpoolClient, getOrcaConnection, getWhirlpoolCtx } from './client.js';
import {
  PDAUtil,
  decreaseLiquidityQuoteByLiquidityWithParams,
  TokenExtensionUtil,
} from '@orca-so/whirlpools-sdk';
import { Percentage } from '@orca-so/common-sdk';
import { arciumPrivacy } from '../privacy/index.js';
import { discoverOrcaPositions } from './positions.js';

export interface OrcaWithdrawParams {
  walletAddress: string;
  poolAddress: string;
  positionMintAddress?: string; // NFT mint - if not provided, will discover from wallet
  positionAddress?: string; // Position PDA - used to identify which position if mint not given
  slippageBps?: number;
}

export interface BuiltOrcaWithdraw {
  unsignedTransactions: string[];
  estimatedWithdraw: { tokenA: string; tokenB: string };
  fees: { tokenA: string; tokenB: string };
}

export async function buildOrcaWithdraw(params: OrcaWithdrawParams): Promise<BuiltOrcaWithdraw> {
  const { walletAddress, poolAddress, slippageBps = 300 } = params;
  let { positionMintAddress, positionAddress } = params;
  
  // If no mintAddress but we have positionAddress (PDA), discover the mint
  if (!positionMintAddress && positionAddress) {
    console.log(`[Orca Withdraw] No mint provided, discovering from wallet...`);
    const connection = getOrcaConnection();
    const positions = await discoverOrcaPositions(connection, walletAddress);
    
    // Find position by address (PDA) or pool
    const match = positions.find(p => 
      p.address === positionAddress || 
      (p.poolAddress === poolAddress && positions.length === 1)
    );
    
    if (match?.mintAddress) {
      positionMintAddress = match.mintAddress;
      console.log(`[Orca Withdraw] Found mint: ${positionMintAddress}`);
    } else {
      throw new Error(`Could not find Orca position mint. Position: ${positionAddress}, Pool: ${poolAddress}`);
    }
  }
  
  if (!positionMintAddress) {
    throw new Error('positionMintAddress is required for Orca withdrawal');
  }
  
  // Encrypt strategy with Arcium before execution
  const encrypted = await arciumPrivacy.encryptStrategy({
    intent: 'orca_withdraw',
    pool: poolAddress,
    position: positionMintAddress,
  });
  console.log(`[Orca Withdraw] Strategy encrypted: ${encrypted.ciphertext.slice(0, 20)}...`);

  const connection = getOrcaConnection();
  const client = getWhirlpoolClient(connection);
  const ctx = getWhirlpoolCtx(connection);

  const positionPDA = PDAUtil.getPosition(
    ctx.program.programId,
    new PublicKey(positionMintAddress),
  );
  const position = await client.getPosition(positionPDA.publicKey);
  const posData = position.getData();

  const pool = await client.getPool(posData.whirlpool);
  const poolData = pool.getData();

  const slippage = Percentage.fromFraction(slippageBps, 10000);

  // Estimate withdrawal amounts
  const fetcher = client.getFetcher();
  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContextForPool(
    fetcher, poolData.tokenMintA, poolData.tokenMintB,
  );
  const decreaseQuote = decreaseLiquidityQuoteByLiquidityWithParams({
    liquidity: posData.liquidity,
    sqrtPrice: poolData.sqrtPrice,
    tickLowerIndex: posData.tickLowerIndex,
    tickUpperIndex: posData.tickUpperIndex,
    tickCurrentIndex: poolData.tickCurrentIndex,
    slippageTolerance: slippage,
    tokenExtensionCtx,
  });

  // Use the SDK's closePosition which handles:
  // 1. Decrease all liquidity
  // 2. Collect fees
  // 3. Close position account
  const closeTxBuilders = await pool.closePosition(
    positionPDA.publicKey,
    slippage,
    walletAddress, // destinationWallet
    walletAddress, // positionWallet
    walletAddress, // payer
  );

  const unsignedTransactions: string[] = [];

  for (const txBuilder of closeTxBuilders) {
    const payload = await txBuilder.build();
    const tx = payload.transaction;

    // Sign with any SDK-generated signers
    if (payload.signers.length > 0) {
      if (tx instanceof VersionedTransaction) {
        tx.sign(payload.signers);
      } else {
        tx.partialSign(...payload.signers);
      }
    }

    if (tx instanceof VersionedTransaction) {
      unsignedTransactions.push(
        Buffer.from(tx.serialize()).toString('base64'),
      );
    } else {
      tx.feePayer = new PublicKey(walletAddress);
      const serialized = tx.serialize({ requireAllSignatures: false });
      unsignedTransactions.push(serialized.toString('base64'));
    }
  }

  return {
    unsignedTransactions,
    estimatedWithdraw: {
      tokenA: decreaseQuote.tokenEstA?.toString() || '0',
      tokenB: decreaseQuote.tokenEstB?.toString() || '0',
    },
    fees: {
      tokenA: posData.feeOwedA.toString(),
      tokenB: posData.feeOwedB.toString(),
    },
  };
}
