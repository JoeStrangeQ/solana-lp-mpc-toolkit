/**
 * Jupiter V6 Swap Client
 * 
 * Simple swap integration using Jupiter's quote and swap APIs.
 * Used to prepare liquidity (swap to 50/50) before LP-ing.
 */

import { config } from '../config';

// Well-known token mints
export const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
} as const;

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot?: number;
  timeTaken?: number;
}

export interface SwapResult {
  swapTransaction: string; // Base64 encoded transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

export class JupiterClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.jupiter.baseUrl;
    this.apiKey = config.jupiter.apiKey;
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Get a quote for swapping tokens
   * @param inputMint - Input token mint address
   * @param outputMint - Output token mint address  
   * @param amount - Amount in base units (lamports for SOL, etc)
   * @param slippageBps - Slippage tolerance in basis points (default 50 = 0.5%)
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number | string,
    slippageBps = 50
  ): Promise<JupiterQuote> {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
    });

    const url = `${this.baseUrl}/quote?${params}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<JupiterQuote>;
  }

  /**
   * Build a swap transaction from a quote
   * @param quote - Quote from getQuote()
   * @param userPublicKey - User's wallet public key
   * @returns Serialized transaction ready for signing
   */
  async swap(quote: JupiterQuote, userPublicKey: string): Promise<SwapResult> {
    const url = `${this.baseUrl}/swap`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<SwapResult>;
  }

  /**
   * Convenience method: Get quote and build swap transaction in one call
   */
  async getSwapTransaction(
    inputMint: string,
    outputMint: string,
    amount: number | string,
    userPublicKey: string,
    slippageBps = 50
  ): Promise<{ quote: JupiterQuote; swap: SwapResult }> {
    const quote = await this.getQuote(inputMint, outputMint, amount, slippageBps);
    const swap = await this.swap(quote, userPublicKey);
    return { quote, swap };
  }

  /**
   * Resolve token symbol to mint address
   */
  resolveTokenMint(symbolOrMint: string): string {
    const upper = symbolOrMint.toUpperCase();
    if (upper in TOKENS) {
      return TOKENS[upper as keyof typeof TOKENS];
    }
    // Assume it's already a mint address
    return symbolOrMint;
  }
}

// Export singleton instance
export const jupiterClient = new JupiterClient();
export default JupiterClient;
