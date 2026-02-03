/**
 * Arcium Privacy Types
 */

export interface EncryptedStrategy {
  ciphertext: string;
  nonce: string;
  publicKey: string; // Ephemeral public key for ECDH
  timestamp: number;
}

export interface LPStrategy {
  intent: 'open_position' | 'add_liquidity' | 'remove_liquidity' | 'close_position';
  dex: string;
  pool: string;
  tokenA: string;
  tokenB: string;
  amountA?: number;
  amountB?: number;
  lowerPrice?: number;
  upperPrice?: number;
  percentage?: number;
  slippage: number;
}

export interface EncryptedPosition {
  positionId: string;
  encryptedData: string;
  owner: string;
}

export interface PrivacyConfig {
  mxePublicKey: string;
  clusterOffset: number;
}
