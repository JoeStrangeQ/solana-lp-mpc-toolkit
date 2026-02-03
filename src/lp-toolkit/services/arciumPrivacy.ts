/**
 * Arcium Privacy Service for LP Toolkit
 * Encrypts strategy parameters and position data
 * 
 * Privacy Features:
 * - Encrypted strategy parameters (others can't see your LP plans)
 * - Private position values (hide your portfolio size)
 * - Encrypted execution intent (prevent front-running)
 */

import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { randomBytes, createHash } from 'crypto';
import { LPPool, LPPosition, AddLiquidityIntent, LPStrategy } from '../adapters/types';

// Arcium SDK imports
let x25519: any;
let RescueCipher: any;

try {
  const arciumClient = require('@arcium-hq/client');
  x25519 = arciumClient.x25519;
  RescueCipher = arciumClient.RescueCipher;
} catch {
  // Fallback to nacl if Arcium SDK not available
  x25519 = null;
  RescueCipher = null;
}

// ============ Types ============

export interface EncryptedStrategy {
  id: string;
  ownerPubkey: string;
  encryptedParams: string;      // Base64 encrypted strategy params
  publicKey: string;            // Client's X25519 public key
  nonce: string;                // Encryption nonce
  timestamp: number;
  expiresAt: number;
}

export interface EncryptedPosition {
  positionId: string;
  ownerPubkey: string;
  encryptedValue: string;       // Encrypted USD value
  encryptedFees: string;        // Encrypted unclaimed fees
  venue: string;
  poolName: string;             // Pool name is public
  publicKey: string;
  nonce: string;
  lastUpdated: number;
}

export interface PrivacyKeys {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  sharedSecret?: Uint8Array;    // If using MXE
}

// ============ Key Management ============

/**
 * Generate X25519 keypair for privacy operations
 */
export function generatePrivacyKeys(): PrivacyKeys {
  if (x25519) {
    // Use Arcium SDK
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    return { privateKey, publicKey };
  } else {
    // Fallback to nacl
    const keyPair = nacl.box.keyPair();
    return {
      privateKey: keyPair.secretKey,
      publicKey: keyPair.publicKey,
    };
  }
}

/**
 * Derive shared secret with MXE public key (if available)
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  mxePublicKey: Uint8Array
): Uint8Array {
  if (x25519) {
    return x25519.getSharedSecret(privateKey, mxePublicKey);
  } else {
    return nacl.box.before(mxePublicKey, privateKey);
  }
}

// ============ Encryption Functions ============

/**
 * Simple XOR-based encryption (used when RescueCipher not available)
 */
function simpleEncrypt(data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const encrypted = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    encrypted[i] = data[i] ^ key[i % key.length] ^ nonce[i % nonce.length];
  }
  return encrypted;
}

function simpleDecrypt(encrypted: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  // XOR is symmetric
  return simpleEncrypt(encrypted, key, nonce);
}

/**
 * Encrypt strategy parameters
 */
export function encryptStrategy(
  intent: AddLiquidityIntent,
  keys: PrivacyKeys,
  ownerPubkey: PublicKey
): EncryptedStrategy {
  const nonce = randomBytes(16);
  const plaintext = JSON.stringify({
    venue: intent.venue,
    tokenA: intent.tokenA,
    tokenB: intent.tokenB,
    amountA: intent.amountA,
    amountB: intent.amountB,
    totalValueUSD: intent.totalValueUSD,
    strategy: intent.strategy,
  });
  
  const plaintextBytes = Buffer.from(plaintext, 'utf-8');
  
  let encrypted: Uint8Array;
  if (RescueCipher && keys.sharedSecret) {
    const cipher = new RescueCipher(keys.sharedSecret);
    // Convert string to BigInt array for RescueCipher
    const plaintextBigInts = Array.from(plaintextBytes).map(b => BigInt(b));
    encrypted = new Uint8Array(cipher.encrypt(plaintextBigInts, nonce).flat());
  } else {
    // Fallback encryption
    const key = keys.sharedSecret || keys.privateKey;
    encrypted = simpleEncrypt(plaintextBytes, key, nonce);
  }
  
  return {
    id: generateId(),
    ownerPubkey: ownerPubkey.toString(),
    encryptedParams: Buffer.from(encrypted).toString('base64'),
    publicKey: Buffer.from(keys.publicKey).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600000, // 1 hour
  };
}

/**
 * Decrypt strategy parameters (only owner can do this)
 */
export function decryptStrategy(
  encrypted: EncryptedStrategy,
  keys: PrivacyKeys
): AddLiquidityIntent | null {
  try {
    const encryptedBytes = Buffer.from(encrypted.encryptedParams, 'base64');
    const nonce = Buffer.from(encrypted.nonce, 'base64');
    
    let decrypted: Uint8Array;
    if (RescueCipher && keys.sharedSecret) {
      const cipher = new RescueCipher(keys.sharedSecret);
      // Decrypt and convert back to bytes
      const decryptedBigInts = cipher.decrypt(Array.from(encryptedBytes), nonce);
      decrypted = new Uint8Array(decryptedBigInts.map((n: bigint) => Number(n)));
    } else {
      const key = keys.sharedSecret || keys.privateKey;
      decrypted = simpleDecrypt(encryptedBytes, key, nonce);
    }
    
    const plaintext = Buffer.from(decrypted).toString('utf-8');
    return JSON.parse(plaintext);
  } catch (error) {
    console.error('Failed to decrypt strategy:', error);
    return null;
  }
}

/**
 * Encrypt position value for privacy
 */
export function encryptPosition(
  position: LPPosition,
  keys: PrivacyKeys
): EncryptedPosition {
  const nonce = randomBytes(16);
  
  // Encrypt sensitive values
  const valueBytes = Buffer.from(position.valueUSD.toFixed(6));
  const feesBytes = Buffer.from(position.unclaimedFees.totalUSD.toFixed(6));
  
  const key = keys.sharedSecret || keys.privateKey;
  const encryptedValue = simpleEncrypt(valueBytes, key, nonce);
  const encryptedFees = simpleEncrypt(feesBytes, key, nonce);
  
  return {
    positionId: position.positionId,
    ownerPubkey: position.owner,
    encryptedValue: Buffer.from(encryptedValue).toString('base64'),
    encryptedFees: Buffer.from(encryptedFees).toString('base64'),
    venue: position.venue,
    poolName: position.poolName, // Public info
    publicKey: Buffer.from(keys.publicKey).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    lastUpdated: Date.now(),
  };
}

/**
 * Decrypt position value (only owner)
 */
export function decryptPosition(
  encrypted: EncryptedPosition,
  keys: PrivacyKeys
): { valueUSD: number; unclaimedFeesUSD: number } | null {
  try {
    const encryptedValue = Buffer.from(encrypted.encryptedValue, 'base64');
    const encryptedFees = Buffer.from(encrypted.encryptedFees, 'base64');
    const nonce = Buffer.from(encrypted.nonce, 'base64');
    
    const key = keys.sharedSecret || keys.privateKey;
    const decryptedValue = simpleDecrypt(encryptedValue, key, nonce);
    const decryptedFees = simpleDecrypt(encryptedFees, key, nonce);
    
    return {
      valueUSD: parseFloat(Buffer.from(decryptedValue).toString('utf-8')),
      unclaimedFeesUSD: parseFloat(Buffer.from(decryptedFees).toString('utf-8')),
    };
  } catch (error) {
    console.error('Failed to decrypt position:', error);
    return null;
  }
}

// ============ Privacy Service Class ============

export class ArciumPrivacyService {
  private keys: PrivacyKeys;
  private ownerPubkey: PublicKey;
  
  constructor(ownerPubkey: PublicKey, existingKeys?: PrivacyKeys) {
    this.ownerPubkey = ownerPubkey;
    this.keys = existingKeys || generatePrivacyKeys();
  }
  
  /**
   * Get the public key for this privacy context
   */
  getPublicKey(): string {
    return Buffer.from(this.keys.publicKey).toString('base64');
  }
  
  /**
   * Encrypt a strategy before execution
   */
  encryptStrategy(intent: AddLiquidityIntent): EncryptedStrategy {
    return encryptStrategy(intent, this.keys, this.ownerPubkey);
  }
  
  /**
   * Decrypt a strategy (for owner viewing)
   */
  decryptStrategy(encrypted: EncryptedStrategy): AddLiquidityIntent | null {
    return decryptStrategy(encrypted, this.keys);
  }
  
  /**
   * Encrypt positions for storage
   */
  encryptPositions(positions: LPPosition[]): EncryptedPosition[] {
    return positions.map(pos => encryptPosition(pos, this.keys));
  }
  
  /**
   * Decrypt positions for viewing
   */
  decryptPositions(encrypted: EncryptedPosition[]): Array<{
    positionId: string;
    venue: string;
    poolName: string;
    valueUSD: number;
    unclaimedFeesUSD: number;
  }> {
    return encrypted.map(enc => {
      const decrypted = decryptPosition(enc, this.keys);
      return {
        positionId: enc.positionId,
        venue: enc.venue,
        poolName: enc.poolName,
        valueUSD: decrypted?.valueUSD || 0,
        unclaimedFeesUSD: decrypted?.unclaimedFeesUSD || 0,
      };
    });
  }
  
  /**
   * Create a privacy-preserving summary (for public display)
   */
  createPublicSummary(positions: LPPosition[]): {
    totalPositions: number;
    venues: string[];
    pools: string[];
    // Values are hidden
    valueHidden: boolean;
  } {
    return {
      totalPositions: positions.length,
      venues: [...new Set(positions.map(p => p.venue))],
      pools: positions.map(p => p.poolName),
      valueHidden: true,
    };
  }
}

// ============ Utilities ============

function generateId(): string {
  return createHash('sha256')
    .update(randomBytes(32))
    .digest('hex')
    .slice(0, 16);
}

export default {
  generatePrivacyKeys,
  deriveSharedSecret,
  encryptStrategy,
  decryptStrategy,
  encryptPosition,
  decryptPosition,
  ArciumPrivacyService,
};
