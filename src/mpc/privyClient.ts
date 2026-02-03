/**
 * Privy Embedded Wallet Client
 * 
 * Uses Privy's server-side API to create and manage embedded wallets
 * for AI agents. Replaces Portal MPC with same interface.
 */

import { PrivyClient } from '@privy-io/node';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as bs58 from 'bs58';

export interface PrivyWalletInfo {
  id: string;
  address: string;
  chainType: 'solana';
  createdAt: string;
}

export interface PrivyConfig {
  appId: string;
  appSecret: string;
}

export class PrivyWalletClient {
  private client: PrivyClient;
  private wallet: PrivyWalletInfo | null = null;
  private userId: string | null = null;

  constructor(config: PrivyConfig) {
    this.client = new PrivyClient({
      appId: config.appId,
      appSecret: config.appSecret,
    });
  }

  /**
   * Create a new embedded wallet for an agent
   * Privy creates a user + wallet in one step
   */
  async generateWallet(): Promise<{
    id: string;
    addresses: { solana: string };
    userId: string;
    createdAt: string;
  }> {
    try {
      // Create a new Privy user with an embedded Solana wallet
      const user = await this.client.createUser({
        createEmbeddedWallet: true,
        linkedAccounts: [],
      });

      // Find the Solana wallet
      const solanaWallet = user.linkedAccounts.find(
        (account: { type: string; chainType?: string }) => 
          account.type === 'wallet' && account.chainType === 'solana'
      ) as { address: string; id: string } | undefined;

      if (!solanaWallet) {
        throw new Error('Failed to create Solana wallet');
      }

      this.userId = user.id;
      this.wallet = {
        id: solanaWallet.id,
        address: solanaWallet.address,
        chainType: 'solana',
        createdAt: new Date().toISOString(),
      };

      return {
        id: this.wallet.id,
        addresses: { solana: this.wallet.address },
        userId: user.id,
        createdAt: this.wallet.createdAt,
      };
    } catch (error) {
      console.error('[Privy] Failed to generate wallet:', error);
      throw error;
    }
  }

  /**
   * Load an existing wallet by user ID
   */
  async loadWallet(userId: string): Promise<PrivyWalletInfo> {
    try {
      const user = await this.client.getUser(userId);
      
      const solanaWallet = user.linkedAccounts.find(
        (account: { type: string; chainType?: string }) => 
          account.type === 'wallet' && account.chainType === 'solana'
      ) as { address: string; id: string } | undefined;

      if (!solanaWallet) {
        throw new Error('No Solana wallet found for user');
      }

      this.userId = userId;
      this.wallet = {
        id: solanaWallet.id,
        address: solanaWallet.address,
        chainType: 'solana',
        createdAt: new Date().toISOString(),
      };

      return this.wallet;
    } catch (error) {
      console.error('[Privy] Failed to load wallet:', error);
      throw error;
    }
  }

  /**
   * Sign a transaction using Privy's embedded wallet
   */
  async signTransaction(transactionBase64: string): Promise<string> {
    if (!this.wallet || !this.userId) {
      throw new Error('No wallet loaded');
    }

    try {
      // Privy expects the transaction as base64
      const result = await this.client.walletApi.solana.signTransaction({
        userId: this.userId,
        walletId: this.wallet.id,
        transaction: transactionBase64,
      });

      return result.signedTransaction;
    } catch (error) {
      console.error('[Privy] Failed to sign transaction:', error);
      throw error;
    }
  }

  /**
   * Sign a message
   */
  async signMessage(message: string): Promise<string> {
    if (!this.wallet || !this.userId) {
      throw new Error('No wallet loaded');
    }

    try {
      const result = await this.client.walletApi.solana.signMessage({
        userId: this.userId,
        walletId: this.wallet.id,
        message: Buffer.from(message).toString('base64'),
      });

      return result.signature;
    } catch (error) {
      console.error('[Privy] Failed to sign message:', error);
      throw error;
    }
  }

  isWalletLoaded(): boolean {
    return this.wallet !== null;
  }

  getAddress(): string {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.wallet.address;
  }

  getWalletId(): string {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.wallet.id;
  }

  getUserId(): string {
    if (!this.userId) throw new Error('No user loaded');
    return this.userId;
  }
}

export default PrivyWalletClient;
