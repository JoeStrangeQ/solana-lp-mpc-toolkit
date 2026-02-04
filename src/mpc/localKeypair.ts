/**
 * Local Keypair Wallet Client
 * 
 * Simple wallet using a local Solana keypair for testing.
 * WARNING: Only for testing - keypair is stored in memory/env.
 */

import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

export class LocalKeypairClient {
  private keypair: Keypair;

  constructor(privateKeyBase58?: string) {
    if (privateKeyBase58) {
      this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    } else {
      // Generate new keypair if none provided
      this.keypair = Keypair.generate();
      console.log('[LocalKeypair] Generated new wallet:', this.keypair.publicKey.toBase58());
      console.log('[LocalKeypair] Private key (SAVE THIS):', bs58.encode(this.keypair.secretKey));
    }
  }

  getAddress(): string {
    return this.keypair.publicKey.toBase58();
  }

  async signTransaction(transactionBase64: string): Promise<string> {
    const txBuffer = Buffer.from(transactionBase64, 'base64');
    
    try {
      // Try as VersionedTransaction first
      const vTx = VersionedTransaction.deserialize(txBuffer);
      vTx.sign([this.keypair]);
      return Buffer.from(vTx.serialize()).toString('base64');
    } catch {
      // Fall back to legacy Transaction
      const tx = Transaction.from(txBuffer);
      tx.partialSign(this.keypair);
      return tx.serialize({ requireAllSignatures: false }).toString('base64');
    }
  }

  async signAndSendTransaction(transactionBase64: string): Promise<string> {
    // For local keypair, just sign - the caller will broadcast
    return this.signTransaction(transactionBase64);
  }
}
