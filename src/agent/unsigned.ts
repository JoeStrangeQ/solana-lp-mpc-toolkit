/**
 * Unsigned Transaction Builder API
 * 
 * Stateless endpoints for agents to build LP transactions.
 * Agents sign with their own wallets - we never hold private keys.
 * 
 * Flow:
 * 1. Agent encrypts strategy params with Arcium
 * 2. POST /lp/build → returns unsigned transaction
 * 3. Agent signs locally with their wallet
 * 4. Agent broadcasts OR POST /broadcast with signed tx
 */

import { Hono } from 'hono';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { arciumPrivacy } from '../privacy';
import { MeteoraDirectClient } from '../dex/meteora';
import { jupiterClient, TOKENS } from '../swap';

const app = new Hono();

// Shared connection
const connection = new Connection(config.solana.rpc, 'confirmed');
const meteoraClient = new MeteoraDirectClient(config.solana.rpc);

interface BuildLPRequest {
  // Agent's wallet address (they control the key)
  walletAddress: string;
  
  // Strategy params - can be encrypted with Arcium
  tokenA: string;
  tokenB: string;
  amountUsd: number;
  
  // Optional: pre-encrypted params (Arcium)
  encryptedParams?: string;
  
  // Optional: specific pool address
  poolAddress?: string;
}

interface BuildSwapRequest {
  walletAddress: string;
  inputToken: string;
  outputToken: string;
  amount: number;
  slippageBps?: number;
}

/**
 * Build unsigned LP transaction
 * Agent signs this with their own wallet
 */
app.post('/lp/build', async (c) => {
  try {
    const body = await c.req.json() as BuildLPRequest;
    
    // If params are encrypted, decrypt inside Arcium MXE
    let params = body;
    if (body.encryptedParams) {
      // In production, this decryption happens inside Arcium MXE
      // For demo, we just verify it's a non-empty string
      if (typeof body.encryptedParams !== 'string' || body.encryptedParams.length < 10) {
        return c.json({ success: false, error: 'Invalid Arcium encryption' }, 400);
      }
      // Decryption would happen in MXE - for demo, params are in clear
    }
    
    const { walletAddress, tokenA, tokenB, amountUsd, poolAddress } = params;
    
    if (!walletAddress || !tokenA || !tokenB || !amountUsd) {
      return c.json({
        success: false,
        error: 'Missing required fields: walletAddress, tokenA, tokenB, amountUsd',
      }, 400);
    }
    
    // Validate wallet address
    try {
      new PublicKey(walletAddress);
    } catch {
      return c.json({ success: false, error: 'Invalid wallet address' }, 400);
    }
    
    // Find best pool if not specified
    let targetPool = poolAddress;
    if (!targetPool) {
      // Default SOL-USDC pool
      targetPool = 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';
    }
    
    // Get pool info and current price
    const poolInfo = await meteoraClient.getPoolInfo(targetPool);
    
    // Calculate token amounts based on USD value and current price
    // For SOL-USDC: price is SOL per USDC
    const solPrice = poolInfo.currentPrice; // SOL price in USDC
    const halfValueUsd = amountUsd / 2;
    
    // Amount of SOL needed (in lamports)
    const solAmount = Math.floor((halfValueUsd / solPrice) * 1e9);
    // Amount of USDC needed (in micro-USDC, 6 decimals)
    const usdcAmount = Math.floor(halfValueUsd * 1e6);
    
    // Build the unsigned LP transaction
    const lpResult = await meteoraClient.buildAddLiquidityTx({
      poolAddress: targetPool,
      userPublicKey: walletAddress,
      amountX: solAmount,  // SOL in lamports
      amountY: usdcAmount, // USDC in micro-units
      slippageBps: 100,
    });
    
    return c.json({
      success: true,
      data: {
        // Unsigned transaction - agent must sign with their wallet
        unsignedTransaction: lpResult.transaction,
        
        // Position info
        positionAddress: lpResult.positionAddress,
        positionKeypair: lpResult.positionKeypair, // Agent needs this to co-sign
        binRange: lpResult.binRange,
        
        // Pool info
        pool: {
          address: targetPool,
          price: poolInfo.currentPrice,
          binStep: poolInfo.binStep,
        },
        
        // Amounts
        amounts: {
          tokenA: { symbol: tokenA, amount: solAmount, decimals: 9 },
          tokenB: { symbol: tokenB, amount: usdcAmount, decimals: 6 },
          totalUsd: amountUsd,
        },
        
        // Instructions for agent
        instructions: {
          step1: 'Sign the unsignedTransaction with your wallet',
          step2: 'Also sign with positionKeypair (new position account)',
          step3: 'Broadcast the fully signed transaction',
        },
      },
    });
  } catch (error) {
    console.error('[/lp/build] Error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Build unsigned swap transaction (for rebalancing)
 */
app.post('/swap/build', async (c) => {
  try {
    const { walletAddress, inputToken, outputToken, amount, slippageBps = 100 } = await c.req.json() as BuildSwapRequest;
    
    if (!walletAddress || !inputToken || !outputToken || !amount) {
      return c.json({
        success: false,
        error: 'Missing required fields: walletAddress, inputToken, outputToken, amount',
      }, 400);
    }
    
    // Resolve token mints
    const tokenMap: Record<string, string> = TOKENS as Record<string, string>;
    const inputMint = tokenMap[inputToken.toUpperCase()] || inputToken;
    const outputMint = tokenMap[outputToken.toUpperCase()] || outputToken;
    
    // Get quote from Jupiter
    const quote = await jupiterClient.getQuote(inputMint, outputMint, amount, slippageBps);
    
    // Build swap transaction
    const swapResult = await jupiterClient.swap(quote, walletAddress);
    
    return c.json({
      success: true,
      data: {
        unsignedTransaction: swapResult.swapTransaction,
        quote: {
          inputAmount: quote.inAmount,
          outputAmount: quote.outAmount,
          priceImpact: quote.priceImpactPct,
        },
        instructions: {
          step1: 'Sign the unsignedTransaction with your wallet',
          step2: 'Broadcast the signed transaction',
        },
      },
    });
  } catch (error) {
    console.error('[/swap/build] Error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Broadcast a signed transaction
 * Agent can use this or broadcast directly to RPC
 */
app.post('/broadcast', async (c) => {
  try {
    const { signedTransaction } = await c.req.json();
    
    if (!signedTransaction) {
      return c.json({ success: false, error: 'Missing signedTransaction' }, 400);
    }
    
    const txBuffer = Buffer.from(signedTransaction, 'base64');
    const txid = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    // Wait for confirmation
    await connection.confirmTransaction(txid, 'confirmed');
    
    return c.json({
      success: true,
      data: {
        txid,
        explorer: `https://solscan.io/tx/${txid}`,
      },
    });
  } catch (error) {
    console.error('[/broadcast] Error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Encrypt strategy params with Arcium
 * Returns ciphertext that can only be decrypted in MXE
 */
app.post('/encrypt-strategy', async (c) => {
  try {
    const params = await c.req.json();
    
    // Convert params to LPStrategy format for encryption
    const strategy = {
      pair: params.pair || `${params.tokenA}-${params.tokenB}`,
      amount: params.amount || params.amountUsd,
      binRange: params.binRange as [number, number] | undefined,
      distribution: params.distribution || 'uniform',
      slippage: params.slippage || 100,
      intent: params.intent,
      dex: params.dex || 'meteora',
      pool: params.pool || params.poolAddress,
      tokenA: params.tokenA,
      tokenB: params.tokenB,
      amountA: params.amountA,
      amountB: params.amountB,
    };
    
    // Encrypt with Arcium
    const encrypted = await arciumPrivacy.encryptStrategy(strategy);
    const mxeInfo = arciumPrivacy.getMxeInfo();
    
    return c.json({
      success: true,
      data: {
        encryptedParams: encrypted.ciphertext,
        ephemeralPubkey: encrypted.publicKey,
        nonce: encrypted.nonce,
        mxeCluster: mxeInfo.cluster,
        note: 'Use encryptedParams in /lp/build for private execution',
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
export { app as unsignedApi };
