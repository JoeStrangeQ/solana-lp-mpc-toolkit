/**
 * Mock Portal MPC Wallet Client
 * 
 * Simulates the MPCClient for testing without a real API key.
 */

import type { MPCWallet, GenerateWalletResponse, SignTransactionResponse } from './types';

export class MockMPCClient {
  private wallet: MPCWallet | null = null;

  constructor() {
    console.log(' MOCK_MPC: Using MockMPCClient');
  }

  async generateWallet(): Promise<MPCWallet> {
    const mockAddress = 'mock_solana_address_' + Math.random().toString(36).substring(2, 15);
    this.wallet = {
      id: 'mock_wallet_id',
      addresses: { solana: mockAddress },
      share: 'mock_encrypted_share',
      createdAt: new Date().toISOString(),
    };
    return this.wallet;
  }

  loadWallet(wallet: MPCWallet): void {
    this.wallet = wallet;
  }

  getAddress(): string {
    if (!this.wallet) {
      throw new Error('No mock wallet loaded.');
    }
    return this.wallet.addresses.solana;
  }

  isWalletLoaded(): boolean {
    return this.wallet !== null;
  }

  async signTransaction(unsignedTx: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('No mock wallet loaded.');
    }
    // Simulate signing by appending a mock signature
    const mockSignature = Buffer.from('mock_signature').toString('base64');
    return `${unsignedTx}${mockSignature}`;
  }

  exportWallet(): MPCWallet | null {
    return this.wallet;
  }
}
