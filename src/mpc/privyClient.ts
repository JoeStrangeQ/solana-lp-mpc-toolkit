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
      // Note: signTransaction does NOT use caip2 (only signAndSendTransaction does)
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'signTransaction',
        chain_type: 'solana',
        params: {
          transaction: transactionBase64,
          encoding: 'base64',
        },
      });

      // Response is { data: { signed_transaction: string } }
      return (result as any).data?.signed_transaction || (result as any).signed_transaction;
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
      // Use the Privy SDK RPC API for Solana transactions with caip2
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'signAndSendTransaction',
        caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Solana mainnet
        params: {
          transaction: transactionBase64,
          encoding: 'base64',
        },
      });

      // Response is { data: { hash: string } }
      return (result as any).data?.hash || (result as any).hash || (result as any).transaction_hash;
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
   * Native SOL transfer - builds tx and uses signAndSendTransaction with correct params
   */
  async transfer(recipientAddress: string, lamports: number, connection: any): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      const { PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
      
      const fromPubkey = new PublicKey(this.wallet.address);
      const toPubkey = new PublicKey(recipientAddress);
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      
      // Build transfer transaction
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports,
        })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = fromPubkey;
      
      // Serialize transaction (unsigned, base64)
      const serializedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');
      
      // Use Privy's signAndSendTransaction with correct Solana params format
      const result = await (this.client as any).privyApiClient.wallets._rpc(this.wallet.id, {
        method: 'signAndSendTransaction',
        caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Solana mainnet
        params: {
          transaction: serializedTx,
          encoding: 'base64',
        },
      });

      console.log('[Privy] Transfer result:', result);
      return (result as any).hash || (result as any).transaction_hash || (result as any).txid || result;
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
