/**
 * Swap → LP Pipeline for Meteora DLMM
 * 
 * Orchestrates the full flow:
 * 1. Check wallet balance
 * 2. Calculate optimal 50/50 split at current price
 * 3. Swap if needed (via Jupiter) to get the right ratio
 * 4. Add liquidity to Meteora DLMM
 */

import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config/index.js';
import { jupiterClient, TOKENS } from '../swap/index.js';
import { MeteoraDirectClient } from '../dex/meteora.js';
import { arciumPrivacy } from '../privacy/index.js';

// Well-known pool addresses (Meteora DLMM)
export const METEORA_POOLS = {
  'SOL-USDC': 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y', // Main SOL-USDC DLMM pool ($5M TVL)
} as const;

export interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;        // Base units (lamports, etc)
  balanceUi: number;      // Human-readable (with decimals)
  decimals: number;
  usdValue?: number;
}

export interface PrepareResult {
  ready: boolean;
  needsSwap: boolean;
  currentBalances: {
    tokenX: TokenBalance;
    tokenY: TokenBalance;
  };
  targetAmounts: {
    amountX: number;      // Base units for LP
    amountXUi: number;    // Human readable
    amountY: number;      // Base units for LP
    amountYUi: number;    // Human readable
  };
  poolInfo: {
    address: string;
    currentPrice: number;
    activeBinId: number;
    binStep: number;
    tokenX: string;
    tokenY: string;
  };
  swap?: {
    inputMint: string;
    outputMint: string;
    amountIn: number;     // Base units
    expectedOut: number;  // Base units
    quote?: unknown;
  };
  message: string;
}

export interface ExecuteResult {
  success: boolean;
  swapTxid?: string;
  lpTxid?: string;
  positionAddress?: string;
  binRange?: { min: number; max: number };
  encryptedStrategy?: { ciphertext: string; nonce: string; mxeCluster: number };
  message: string;
}

export interface ExecuteOptions {
  poolAddress?: string; // Custom pool address (overrides token pair lookup)
  strategy?: 'concentrated' | 'wide' | 'custom';
  minBinId?: number; // For custom strategy (relative to active bin)
  maxBinId?: number;
  shape?: 'spot' | 'curve' | 'bidask'; // DLMM distribution shape (default: spot)
}

export class LPPipeline {
  private connection: Connection;
  private meteoraClient: MeteoraDirectClient;

  constructor() {
    this.connection = new Connection(config.solana.rpc);
    this.meteoraClient = new MeteoraDirectClient(config.solana.rpc);
  }

  /**
   * Prepare liquidity by checking balances and calculating what's needed
   */
  async prepareLiquidity(
    walletAddress: string,
    tokenA: string,
    tokenB: string,
    totalValueUsd: number
  ): Promise<PrepareResult> {
    // Resolve pool address (SOL-USDC for now)
    const pairKey = `${tokenA.toUpperCase()}-${tokenB.toUpperCase()}` as keyof typeof METEORA_POOLS;
    const reversePairKey = `${tokenB.toUpperCase()}-${tokenA.toUpperCase()}` as keyof typeof METEORA_POOLS;
    
    let poolAddress = METEORA_POOLS[pairKey] || METEORA_POOLS[reversePairKey];
    
    if (!poolAddress) {
      return {
        ready: false,
        needsSwap: false,
        currentBalances: {} as PrepareResult['currentBalances'],
        targetAmounts: {} as PrepareResult['targetAmounts'],
        poolInfo: {} as PrepareResult['poolInfo'],
        message: `Pool ${tokenA}-${tokenB} not supported yet. Only SOL-USDC is currently supported.`,
      };
    }

    // Get pool info
    const poolInfo = await this.meteoraClient.getPoolInfo(poolAddress);
    const currentPrice = poolInfo.currentPrice; // SOL price in USDC

    // Determine which token is X (base) and Y (quote) in the pool
    const isTokenABase = poolInfo.tokenX === TOKENS[tokenA.toUpperCase() as keyof typeof TOKENS];
    
    // Get wallet balances
    const mintX = poolInfo.tokenX;
    const mintY = poolInfo.tokenY;
    const decimalsX = tokenA.toUpperCase() === 'SOL' ? 9 : 6;
    const decimalsY = tokenB.toUpperCase() === 'SOL' ? 9 : 6;

    const balanceX = await this.getTokenBalance(walletAddress, mintX, decimalsX);
    const balanceY = await this.getTokenBalance(walletAddress, mintY, decimalsY);

    // Calculate target amounts for 50/50 split
    // Each side gets half the USD value
    const halfValueUsd = totalValueUsd / 2;
    
    // For SOL-USDC: 
    // - tokenX = SOL, tokenY = USDC (typically)
    // - Need $halfValueUsd worth of SOL and $halfValueUsd of USDC
    const targetAmountXUi = halfValueUsd / currentPrice; // SOL needed
    const targetAmountYUi = halfValueUsd;                 // USDC needed
    
    const targetAmountX = Math.floor(targetAmountXUi * Math.pow(10, decimalsX));
    const targetAmountY = Math.floor(targetAmountYUi * Math.pow(10, decimalsY));

    // Calculate current USD value of holdings
    const currentValueX = balanceX.balanceUi * currentPrice;
    const currentValueY = balanceY.balanceUi; // USDC is 1:1
    const totalCurrentValue = currentValueX + currentValueY;

    // Check if we need to swap
    let needsSwap = false;
    let swap: PrepareResult['swap'] | undefined;

    // If we have more X than needed and less Y than needed, swap X->Y
    if (balanceX.balanceUi > targetAmountXUi * 1.01 && balanceY.balanceUi < targetAmountYUi * 0.99) {
      needsSwap = true;
      const excessX = balanceX.balanceUi - targetAmountXUi;
      const amountToSwap = Math.floor(excessX * Math.pow(10, decimalsX));
      
      swap = {
        inputMint: mintX,
        outputMint: mintY,
        amountIn: amountToSwap,
        expectedOut: Math.floor(excessX * currentPrice * Math.pow(10, decimalsY)),
      };
    }
    // If we have more Y than needed and less X than needed, swap Y->X
    else if (balanceY.balanceUi > targetAmountYUi * 1.01 && balanceX.balanceUi < targetAmountXUi * 0.99) {
      needsSwap = true;
      const excessY = balanceY.balanceUi - targetAmountYUi;
      const amountToSwap = Math.floor(excessY * Math.pow(10, decimalsY));
      
      swap = {
        inputMint: mintY,
        outputMint: mintX,
        amountIn: amountToSwap,
        expectedOut: Math.floor((excessY / currentPrice) * Math.pow(10, decimalsX)),
      };
    }

    // Check if we have enough total value
    const ready = totalCurrentValue >= totalValueUsd * 0.98; // 2% tolerance

    const symbolX = isTokenABase ? tokenA.toUpperCase() : tokenB.toUpperCase();
    const symbolY = isTokenABase ? tokenB.toUpperCase() : tokenA.toUpperCase();

    return {
      ready,
      needsSwap,
      currentBalances: {
        tokenX: {
          ...balanceX,
          symbol: symbolX,
          usdValue: currentValueX,
        },
        tokenY: {
          ...balanceY,
          symbol: symbolY,
          usdValue: currentValueY,
        },
      },
      targetAmounts: {
        amountX: targetAmountX,
        amountXUi: targetAmountXUi,
        amountY: targetAmountY,
        amountYUi: targetAmountYUi,
      },
      poolInfo: {
        address: poolAddress,
        currentPrice,
        activeBinId: poolInfo.activeBinId,
        binStep: poolInfo.binStep,
        tokenX: mintX,
        tokenY: mintY,
      },
      swap,
      message: ready
        ? needsSwap
          ? `Ready to LP $${totalValueUsd}. Need to swap first to rebalance.`
          : `Ready to LP $${totalValueUsd}. Balances are already optimal.`
        : `Insufficient balance. Have $${totalCurrentValue.toFixed(2)}, need $${totalValueUsd}.`,
    };
  }

  /**
   * Execute the swap step (if needed)
   */
  async executeSwap(
    walletAddress: string,
    swap: PrepareResult['swap'],
    signTransaction: (tx: string) => Promise<string>
  ): Promise<{ txid: string; quote: unknown }> {
    if (!swap) {
      throw new Error('No swap needed');
    }

    // Get Jupiter quote
    const quote = await jupiterClient.getQuote(
      swap.inputMint,
      swap.outputMint,
      swap.amountIn,
      100 // 1% slippage for rebalancing
    );

    // Build swap transaction
    const swapResult = await jupiterClient.swap(quote, walletAddress);

    // Sign the transaction
    const signedTx = await signTransaction(swapResult.swapTransaction);

    // Broadcast
    const txid = await this.broadcastTransaction(signedTx);

    return { txid, quote };
  }

  /**
   * Execute the LP step
   */
  async executeLp(
    walletAddress: string,
    poolAddress: string,
    amountX: number,
    amountY: number,
    signTransaction: (tx: string) => Promise<string>,
    options?: { strategy?: 'concentrated' | 'wide' | 'custom'; minBinId?: number; maxBinId?: number; shape?: 'spot' | 'curve' | 'bidask' }
  ): Promise<{ txid: string; positionAddress: string; binRange: { min: number; max: number } }> {
    // Build the add liquidity transaction
    const lpResult = await this.meteoraClient.buildAddLiquidityTx({
      poolAddress,
      userPublicKey: walletAddress,
      amountX,
      amountY,
      slippageBps: 100, // 1% slippage
      strategy: options?.strategy,
      minBinId: options?.minBinId,
      maxBinId: options?.maxBinId,
      shape: options?.shape,
    });

    // Step 1: Send UNSIGNED transaction to Privy for user wallet signature
    const userSignedTx = await signTransaction(lpResult.transaction);
    
    // Step 2: Add position keypair signature
    const positionKeypair = Keypair.fromSecretKey(Buffer.from(lpResult.positionKeypair, 'base64'));
    const txBuffer = Buffer.from(userSignedTx, 'base64');
    
    let fullySignedTx: string;
    try {
      // Try as VersionedTransaction first
      const vTx = VersionedTransaction.deserialize(txBuffer);
      vTx.sign([positionKeypair]);
      fullySignedTx = Buffer.from(vTx.serialize()).toString('base64');
      console.log('[LP] Added position signature to VersionedTransaction');
    } catch {
      // Fall back to legacy Transaction
      const tx = Transaction.from(txBuffer);
      tx.partialSign(positionKeypair);
      fullySignedTx = tx.serialize().toString('base64');
      console.log('[LP] Added position signature to legacy Transaction');
    }

    // Step 3: Broadcast ourselves
    const txid = await this.broadcastTransaction(fullySignedTx);

    return {
      txid,
      positionAddress: lpResult.positionAddress,
      binRange: lpResult.binRange,
    };
  }

  /**
   * Full pipeline: prepare → swap → LP
   */
  async execute(
    walletAddress: string,
    tokenA: string,
    tokenB: string,
    totalValueUsd: number,
    signTransaction: (tx: string) => Promise<string>,
    options?: ExecuteOptions
  ): Promise<ExecuteResult> {
    // Step 1: Prepare (or use custom pool address)
    let prep: PrepareResult;
    
    if (options?.poolAddress) {
      // Custom pool address provided - get EXTENDED pool info with actual decimals
      try {
        // Use getPoolInfoExtended to get actual decimals from chain (not hardcoded)
        const poolInfo = await this.meteoraClient.getPoolInfoExtended(options.poolAddress);
        
        // Use actual decimals from the pool (universal support for any token)
        const decimalsX = poolInfo.tokenX.decimals;
        const decimalsY = poolInfo.tokenY.decimals;
        
        // Get USD prices for both tokens from Jupiter Price API
        let priceX = 1; // Default to 1 for stablecoins
        let priceY = 1;
        
        try {
          const priceUrl = `https://api.jup.ag/price/v2?ids=${poolInfo.tokenX.mint},${poolInfo.tokenY.mint}`;
          const priceHeaders: Record<string, string> = {};
          if (config.jupiter.apiKey) {
            priceHeaders['x-api-key'] = config.jupiter.apiKey;
          }
          const priceResp = await fetch(priceUrl, { headers: priceHeaders });
          if (priceResp.ok) {
            const priceData = await priceResp.json() as { data: Record<string, { price: string }> };
            priceX = parseFloat(priceData.data[poolInfo.tokenX.mint]?.price || '1');
            priceY = parseFloat(priceData.data[poolInfo.tokenY.mint]?.price || '1');
            console.log(`[LP] USD Prices: tokenX=$${priceX}, tokenY=$${priceY}`);
          } else {
            // API returned non-OK (401, 429, etc.) - use pool ratio fallback
            console.warn(`[LP] Price API returned ${priceResp.status}, using pool ratio fallback`);
            const isYStable = poolInfo.tokenY.mint.startsWith('EPjFWdd5') || poolInfo.tokenY.mint.startsWith('Es9vMFr');
            if (isYStable) {
              priceY = 1;
              priceX = poolInfo.currentPrice; // Pool ratio = X price in terms of stablecoin Y
              console.log(`[LP] Fallback prices: tokenX=$${priceX}, tokenY=$${priceY}`);
            }
          }
        } catch (e) {
          console.warn('[LP] Failed to fetch USD prices, using pool ratio');
          // Fallback: if tokenY looks like USDC/USDT, assume $1
          const isYStable = poolInfo.tokenY.mint.startsWith('EPjFWdd5') || poolInfo.tokenY.mint.startsWith('Es9vMFr');
          if (isYStable) {
            priceY = 1;
            priceX = poolInfo.currentPrice; // Price in terms of stablecoin
          }
        }
        
        // Calculate amounts: split USD value 50/50
        const halfValueUsd = totalValueUsd / 2;
        const amountXUi = halfValueUsd / priceX;
        const amountYUi = halfValueUsd / priceY;
        
        prep = {
          ready: true,
          needsSwap: false, // Skip swap for custom pool, user manages balance
          currentBalances: {} as PrepareResult['currentBalances'],
          targetAmounts: {
            amountX: Math.floor(amountXUi * Math.pow(10, decimalsX)),
            amountXUi,
            amountY: Math.floor(amountYUi * Math.pow(10, decimalsY)),
            amountYUi,
          },
          poolInfo: {
            address: options.poolAddress,
            currentPrice: poolInfo.currentPrice,
            activeBinId: poolInfo.activeBinId,
            binStep: poolInfo.binStep,
            tokenX: poolInfo.tokenX.mint,
            tokenY: poolInfo.tokenY.mint,
          },
          message: `Using pool ${options.poolAddress}`,
        };
        console.log(`[LP] Pool: ${poolInfo.tokenX.mint.slice(0,8)}... (${decimalsX}d) / ${poolInfo.tokenY.mint.slice(0,8)}... (${decimalsY}d), poolRatio=${poolInfo.currentPrice}`);
        console.log(`[LP] Target amounts: X=${prep.targetAmounts.amountX} (${amountXUi.toFixed(6)} @ $${priceX}), Y=${prep.targetAmounts.amountY} (${amountYUi.toFixed(6)} @ $${priceY})`);
      } catch (error) {
        return {
          success: false,
          message: `Invalid pool address: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    } else {
      prep = await this.prepareLiquidity(walletAddress, tokenA, tokenB, totalValueUsd);
    }
    
    if (!prep.ready) {
      return {
        success: false,
        message: prep.message,
      };
    }

    let swapTxid: string | undefined;

    // Step 2: Swap if needed
    if (prep.needsSwap && prep.swap) {
      try {
        const swapResult = await this.executeSwap(walletAddress, prep.swap, signTransaction);
        swapTxid = swapResult.txid;
        
        // Wait a bit for the swap to settle
        await this.sleep(2000);
        
        // Re-fetch balances after swap
        // In production, you'd want to verify the swap completed
      } catch (error) {
        return {
          success: false,
          swapTxid,
          message: `Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    // Step 3: Encrypt strategy with Arcium (privacy layer)
    let encryptedStrategy: { ciphertext: string; nonce: string; mxeCluster: number } | undefined;
    try {
      await arciumPrivacy.initialize();
      const encrypted = await arciumPrivacy.encryptStrategy({
        intent: 'add_liquidity',
        pair: `${tokenA}-${tokenB}`,
        pool: prep.poolInfo.address,
        amount: totalValueUsd,
        amountA: prep.targetAmounts.amountXUi,
        amountB: prep.targetAmounts.amountYUi,
        slippage: 1.0, // 1% default
      });
      encryptedStrategy = {
        ciphertext: encrypted.ciphertext.slice(0, 32) + '...', // Truncate for response
        nonce: encrypted.nonce,
        mxeCluster: encrypted.mxeCluster ?? 456,
      };
      console.log('[LP] Strategy encrypted with Arcium MXE cluster', encryptedStrategy.mxeCluster);
    } catch (err) {
      console.warn('[LP] Arcium encryption skipped:', err instanceof Error ? err.message : 'Unknown');
    }

    // Step 4: Add liquidity
    try {
      const lpResult = await this.executeLp(
        walletAddress,
        prep.poolInfo.address,
        prep.targetAmounts.amountX,
        prep.targetAmounts.amountY,
        signTransaction,
        {
          strategy: options?.strategy,
          minBinId: options?.minBinId,
          maxBinId: options?.maxBinId,
          shape: options?.shape,
        }
      );

      return {
        success: true,
        swapTxid,
        lpTxid: lpResult.txid,
        positionAddress: lpResult.positionAddress,
        binRange: lpResult.binRange,
        encryptedStrategy, // Include Arcium encryption proof
        message: `Successfully added $${totalValueUsd} liquidity to ${tokenA}-${tokenB} pool`,
      };
    } catch (error) {
      return {
        success: false,
        swapTxid,
        message: `LP failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // ============ Helpers ============

  private async getTokenBalance(
    walletAddress: string,
    mint: string,
    decimals: number
  ): Promise<TokenBalance> {
    const pubkey = new PublicKey(walletAddress);
    
    // Special case for SOL (native)
    if (mint === TOKENS.SOL) {
      const balance = await this.connection.getBalance(pubkey);
      return {
        mint,
        symbol: 'SOL',
        balance,
        balanceUi: balance / Math.pow(10, decimals),
        decimals,
      };
    }

    // SPL token
    try {
      const mintPubkey = new PublicKey(mint);
      const accounts = await this.connection.getTokenAccountsByOwner(pubkey, { mint: mintPubkey });
      
      if (accounts.value.length === 0) {
        return {
          mint,
          symbol: this.getSymbolForMint(mint),
          balance: 0,
          balanceUi: 0,
          decimals,
        };
      }

      // Parse token account data to get balance
      const accountData = accounts.value[0].account.data;
      // Token account layout: mint (32) + owner (32) + amount (8)
      const amount = accountData.readBigUInt64LE(64);
      const balance = Number(amount);

      return {
        mint,
        symbol: this.getSymbolForMint(mint),
        balance,
        balanceUi: balance / Math.pow(10, decimals),
        decimals,
      };
    } catch {
      return {
        mint,
        symbol: this.getSymbolForMint(mint),
        balance: 0,
        balanceUi: 0,
        decimals,
      };
    }
  }

  private getSymbolForMint(mint: string): string {
    for (const [symbol, address] of Object.entries(TOKENS)) {
      if (address === mint) return symbol;
    }
    return mint.slice(0, 4) + '...';
  }

  private async broadcastTransaction(signedTx: string): Promise<string> {
    const txBuffer = Buffer.from(signedTx, 'base64');
    const txid = await this.connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await this.connection.confirmTransaction(txid, 'confirmed');
    return txid;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton
export const lpPipeline = new LPPipeline();
export default LPPipeline;
