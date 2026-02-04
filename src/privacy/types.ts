/**
 * Arcium Privacy Types
 */

export interface LPStrategy {
  pair?: string;
  amount?: number;
  binRange?: [number, number];
  distribution?: 'uniform' | 'gaussian' | 'bid-heavy' | 'ask-heavy';
  slippage?: number;
  autoCompound?: boolean;
  // Extended fields for full LP operations
  intent?: string;
  dex?: string;
  pool?: string;
  tokenA?: string;
  tokenB?: string;
  amountA?: number;
  amountB?: number;
}

export interface EncryptedStrategy {
  ciphertext: string;       // Base64 encoded ciphertext + auth tag
  nonce: string;            // Base64 encoded 12-byte nonce
  publicKey: string;        // Base64 encoded ephemeral public key
  mxeCluster?: number;      // Arcium MXE cluster ID (456 for devnet)
  algorithm?: string;       // Encryption algorithm used
  timestamp: number;        // Encryption timestamp
}

export interface ArciumConfig {
  mxePublicKey: string;
  cluster: number;
  network: 'devnet' | 'mainnet';
}
