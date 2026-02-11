/**
 * Orca Whirlpool Withdraw Pipeline
 *
 * Builds decrease liquidity + collect fees + close position transactions.
 * Uses the SDK's closePosition which handles all three steps.
 */

import { PublicKey, VersionedTransaction, MessageV0, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
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

  // Ensure ATAs exist for both tokens (fixes InsufficientFundsForRent error)
  const walletPubkey = new PublicKey(walletAddress);
  const tokenAMint = poolData.tokenMintA;
  const tokenBMint = poolData.tokenMintB;
  
  const ataInstructions: any[] = [];
  const blockhash = (await connection.getLatestBlockhash()).blockhash;
  
  // Check and create ATA for token A (including WSOL for native SOL)
  const NATIVE_SOL = new PublicKey('So11111111111111111111111111111111111111112');
  const ataA = await getAssociatedTokenAddress(tokenAMint, walletPubkey);
  try {
    await getAccount(connection, ataA);
    console.log(`[Orca Withdraw] ATA for token A exists: ${ataA.toBase58()}`);
  } catch {
    console.log(`[Orca Withdraw] Creating ATA for token A: ${tokenAMint.toBase58()}`);
    ataInstructions.push(createAssociatedTokenAccountInstruction(walletPubkey, ataA, walletPubkey, tokenAMint));
  }
  
  // Check and create ATA for token B
  const ataB = await getAssociatedTokenAddress(tokenBMint, walletPubkey);
  try {
    await getAccount(connection, ataB);
    console.log(`[Orca Withdraw] ATA for token B exists: ${ataB.toBase58()}`);
  } catch {
    console.log(`[Orca Withdraw] Creating ATA for token B: ${tokenBMint.toBase58()}`);
    ataInstructions.push(createAssociatedTokenAccountInstruction(walletPubkey, ataB, walletPubkey, tokenBMint));
  }
  
  const unsignedTransactions: string[] = [];
  
  // If we need to create ATAs, add that transaction first
  if (ataInstructions.length > 0) {
    const ataTx = new Transaction();
    ataTx.recentBlockhash = blockhash;
    ataTx.feePayer = walletPubkey;
    ataInstructions.forEach(ix => ataTx.add(ix));
    const serialized = ataTx.serialize({ requireAllSignatures: false });
    unsignedTransactions.push(serialized.toString('base64'));
    console.log(`[Orca Withdraw] Added ATA creation tx with ${ataInstructions.length} instructions`);
  }

  // Use decreaseLiquidity + collectFees separately (avoids closePosition rent issues)
  // This withdraws all liquidity and fees but leaves the position open (can be closed later)
  
  // Build decrease liquidity transaction
  // Pass resolveATA=false since we create ATAs ourselves above
  console.log(`[Orca Withdraw] Building decreaseLiquidity tx for ${posData.liquidity.toString()} liquidity...`);
  const decreaseTxBuilder = await position.decreaseLiquidity(
    { liquidityAmount: posData.liquidity, tokenMinA: decreaseQuote.tokenMinA, tokenMinB: decreaseQuote.tokenMinB },
    false, // resolveATA - we handle this ourselves
    walletAddress, // destinationWallet
    walletAddress, // positionWallet
    walletAddress, // ataPayer
  );
  
  // Build collect fees transaction
  console.log(`[Orca Withdraw] Building collectFees tx...`);
  const feesTxBuilder = await position.collectFees(
    true, // updateFeesAndRewards
    undefined, // ownerTokenAccountMap
    walletAddress, // destinationWallet
    walletAddress, // positionWallet  
    walletAddress, // ataPayer
  );
  
  // Combine into transaction list
  const closeTxBuilders = [decreaseTxBuilder, feesTxBuilder];

  for (const txBuilder of closeTxBuilders) {
    const payload = await txBuilder.build();
    let tx = payload.transaction;

    if (tx instanceof VersionedTransaction) {
      // Log transaction structure for debugging
      const msg = tx.message;
      const numSigners = msg.header.numRequiredSignatures;
      console.log(`[Orca Withdraw] Tx #${closeTxBuilders.indexOf(txBuilder)}: ${numSigners} signers required`);
      console.log(`[Orca Withdraw] Signers: ${msg.staticAccountKeys.slice(0, numSigners).map(k => k.toBase58().slice(0,8)).join(', ')}`);

      // Pre-sign with SDK keypairs
      if (payload.signers.length > 0) {
        tx.sign(payload.signers);
        console.log(`[Orca Withdraw] Pre-signed with ${payload.signers.length} keypairs`);
      }

      unsignedTransactions.push(
        Buffer.from(tx.serialize()).toString('base64'),
      );
    } else {
      // Legacy transaction
      tx.feePayer = walletPubkey;
      if (payload.signers.length > 0) {
        tx.partialSign(...payload.signers);
      }
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
