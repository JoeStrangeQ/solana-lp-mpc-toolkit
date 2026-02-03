/**
 * Swap → LP Pipeline for Meteora DLMM
 * 
 * Orchestrates the full flow:
 * 1. Check wallet balance
 * 2. Calculate optimal 50/50 split at current price
 * 3. Swap if needed (via Jupiter) to get the right ratio
 * 4. Add liquidity to Meteora DLMM
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { jupiterClient, TOKENS } from '../swap';
import { MeteoraDirectClient } from '../dex/meteora';

// Well-known pool addresses (Meteora DLMM)
export const METEORA_POOLS = {
  'SOL-USDC': '2sf6e8kWsvVvTEPLkHaJp3YdLt6bNouLNGrz5yeS9t2z', // Main SOL-USDC DLMM pool
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
  message: string;
}

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  BONK: 5,
  WIF: 6,
  JUP: 6,
  RAY: 6,
};

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
    signTransaction: (tx: string) => Promise<string>
  ): Promise<{ txid: string; positionAddress: string; binRange: { min: number; max: number } }> {
    // Build the add liquidity transaction
    const lpResult = await this.meteoraClient.buildAddLiquidityTx({
      poolAddress,
      userPublicKey: walletAddress,
      amountX,
      amountY,
      slippageBps: 100, // 1% slippage
    });

    // Sign the transaction
    const signedTx = await signTransaction(lpResult.transaction);

    // Broadcast
    const txid = await this.broadcastTransaction(signedTx);

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
    signTransaction: (tx: string) => Promise<string>
  ): Promise<ExecuteResult> {
    // Step 1: Prepare
    const prep = await this.prepareLiquidity(walletAddress, tokenA, tokenB, totalValueUsd);
    
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

    // Step 3: Add liquidity
    try {
      const lpResult = await this.executeLp(
        walletAddress,
        prep.poolInfo.address,
        prep.targetAmounts.amountX,
        prep.targetAmounts.amountY,
        signTransaction
      );

      return {
        success: true,
        swapTxid,
        lpTxid: lpResult.txid,
        positionAddress: lpResult.positionAddress,
        binRange: lpResult.binRange,
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
