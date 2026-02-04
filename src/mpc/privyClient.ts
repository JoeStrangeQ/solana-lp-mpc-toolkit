/**
 * Privy Embedded Wallet Client
 * 
 * Uses Privy's server-side Wallets API to create and manage embedded wallets
 * for AI agents. Replaces Portal MPC with same interface.
 */

import { PrivyClient } from '@privy-io/node';

export interface PrivyWalletInfo {
  id: string;
  address: string;
  chainType: 'solana';
  createdAt: string;
}

export interface PrivyConfig {
  appId: string;
  appSecret: string;
  authorizationPrivateKey?: string;
}

export class PrivyWalletClient {
  private client: PrivyClient;
  private wallet: PrivyWalletInfo | null = null;

  constructor(config: PrivyConfig) {
    const clientConfig: any = {
      appId: config.appId,
      appSecret: config.appSecret,
    };
    
    // Add authorization key if provided (required for server wallets)
    if (config.authorizationPrivateKey) {
      // Strip 'wallet-auth:' prefix if present
      const key = config.authorizationPrivateKey.replace('wallet-auth:', '');
      clientConfig.authorizationPrivateKey = key;
    }
    
    this.client = new PrivyClient(clientConfig);
  }

  /**
   * Create a new Solana wallet using Privy's Wallets API
   */
  async generateWallet(): Promise<{
    id: string;
    addresses: { solana: string };
    createdAt: string;
  }> {
    try {
      // Create a new Solana wallet directly via Privy Wallets API
      // Access through privyApiClient which has the create method
      const wallet = await (this.client as any).privyApiClient.wallets.create({
        chain_type: 'solana',
      });

      console.log('[Privy] Wallet created:', wallet.id, wallet.address);

      this.wallet = {
        id: wallet.id,
        address: wallet.address,
        chainType: 'solana',
        createdAt: new Date().toISOString(),
      };

      return {
        id: this.wallet.id,
        addresses: { solana: this.wallet.address },
        createdAt: this.wallet.createdAt,
      };
    } catch (error) {
      console.error('[Privy] Failed to generate wallet:', error);
      throw error;
    }
  }

  /**
   * Load an existing wallet by wallet ID
   */
  async loadWallet(walletId: string): Promise<PrivyWalletInfo> {
    try {
      const wallet = await (this.client as any).privyApiClient.wallets.get(walletId);

      this.wallet = {
        id: wallet.id,
        address: wallet.address,
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
   * Sign a Solana transaction using Privy's Wallets API
   */
  async signTransaction(transactionBase64: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      // Use the Privy SDK RPC API for Solana transactions
      // Access through privyApiClient which has the wallets methods
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'signTransaction',
        params: {
          transaction: transactionBase64,
        },
      });

      return (result as any).signed_transaction;
    } catch (error) {
      console.error('[Privy] Failed to sign transaction:', error);
      throw error;
    }
  }

  /**
   * Sign and send a Solana transaction
   */
  async signAndSendTransaction(transactionBase64: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      // Use the Privy SDK RPC API for Solana transactions
      // Access through privyApiClient which has the wallets methods
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'signAndSendTransaction',
        params: {
          transaction: transactionBase64,
        },
      });

      return (result as any).transaction_hash;
    } catch (error) {
      console.error('[Privy] Failed to sign and send transaction:', error);
      throw error;
    }
  }

  /**
   * Sign a message
   */
  async signMessage(message: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      // Use the Privy SDK RPC API for Solana message signing
      // Access through privyApiClient which has the wallets methods
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'signMessage',
        params: {
          message: message,
          encoding: 'utf-8',
        },
      });

      return (result as any).signature;
    } catch (error) {
      console.error('[Privy] Failed to sign message:', error);
      throw error;
    }
  }

  /**
   * Native SOL transfer using Privy's transfer RPC method
   */
  async transfer(recipientAddress: string, lamports: number): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'transfer',
        params: {
          recipient_public_key: recipientAddress,
          amount_in_lamports: lamports.toString(),
        },
      });

      return (result as any).transaction_hash || (result as any).hash;
    } catch (error) {
      console.error('[Privy] Failed to transfer:', error);
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
}

export default PrivyWalletClient;
