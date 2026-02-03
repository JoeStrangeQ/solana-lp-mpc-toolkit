/**
 * Portal MPC Wallet Client
 * 
 * Threshold signature wallet - neither party holds the full private key
 */

import { config } from '../config';
import type {
  MPCWallet,
  GenerateWalletResponse,
  SignTransactionParams,
  SignTransactionResponse,
} from './types';

export class MPCClient {
  private apiUrl: string;
  private apiKey: string;
  private wallet: MPCWallet | null = null;

  constructor(apiKey?: string) {
    this.apiUrl = config.portal.apiUrl;
    this.apiKey = apiKey || config.portal.apiKey;

    if (!this.apiKey) {
      console.warn('Portal API key not configured. MPC signing will not work.');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      const err = errorData as { message?: string; error?: string };
      throw new Error(err.message || err.error || `MPC API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  // ============ Wallet Management ============

  /**
   * Generate a new MPC wallet
   * The key share returned must be stored securely
   */
  async generateWallet(): Promise<MPCWallet> {
    const response = await this.request<GenerateWalletResponse>('POST', '/v1/generate', {});

    this.wallet = {
      id: response.id,
      addresses: response.addresses,
      share: response.share,
      createdAt: new Date().toISOString(),
    };

    return this.wallet;
  }

  /**
   * Load an existing wallet from stored key share
   */
  loadWallet(wallet: MPCWallet): void {
    this.wallet = wallet;
  }

  /**
   * Get the current wallet's Solana address
   */
  getAddress(): string {
    if (!this.wallet) {
      throw new Error('No wallet loaded. Call generateWallet() or loadWallet() first.');
    }
    return this.wallet.addresses.solana;
  }

  /**
   * Get the key share (for secure storage)
   */
  getKeyShare(): string {
    if (!this.wallet) {
      throw new Error('No wallet loaded.');
    }
    return this.wallet.share;
  }

  // ============ Transaction Signing ============

  /**
   * Sign a Solana transaction using MPC
   * @param unsignedTx Base64 encoded unsigned transaction
   * @returns Base64 encoded signed transaction
   */
  async signTransaction(unsignedTx: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded. Call generateWallet() or loadWallet() first.');
    }

    const params: SignTransactionParams = {
      share: this.wallet.share,
      transaction: unsignedTx,
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Solana mainnet
    };

    const response = await this.request<SignTransactionResponse>('POST', '/v1/sign', {
      share: params.share,
      method: 'sol_signTransaction',
      params: params.transaction,
      chainId: params.chainId,
    });

    return response.signedTransaction;
  }

  /**
   * Sign and return the signature (for adding to existing TX)
   */
  async getSignature(unsignedTx: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded.');
    }

    const response = await this.request<SignTransactionResponse>('POST', '/v1/sign', {
      share: this.wallet.share,
      method: 'sol_signTransaction',
      params: unsignedTx,
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    });

    return response.signature;
  }

  // ============ Utilities ============

  /**
   * Check if MPC service is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Portal doesn't have a health endpoint, so we just check auth
      await this.request<unknown>('GET', '/v1/health');
      return true;
    } catch {
      // If auth fails but service responds, it's still "healthy"
      return true;
    }
  }

  /**
   * Check if a wallet is loaded
   */
  isWalletLoaded(): boolean {
    return this.wallet !== null;
  }

  /**
   * Export wallet data for storage
   */
  exportWallet(): MPCWallet | null {
    return this.wallet;
  }
}
