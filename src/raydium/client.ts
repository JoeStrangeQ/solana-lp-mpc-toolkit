/**
 * Raydium CLMM Client
 * 
 * Initializes and manages the Raydium SDK v2 connection.
 */

import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { config } from '../config/index.js';
import { getConnection } from '../services/connection-pool.js';

// Singleton instance
let _raydiumClient: Raydium | null = null;
let _initPromise: Promise<Raydium> | null = null;

/**
 * Get or initialize Raydium SDK client
 */
export async function getRaydiumClient(): Promise<Raydium> {
  if (_raydiumClient) return _raydiumClient;
  
  if (_initPromise) return _initPromise;
  
  _initPromise = initRaydium();
  _raydiumClient = await _initPromise;
  return _raydiumClient;
}

async function initRaydium(): Promise<Raydium> {
  const connection = getConnection();
  
  // Create a dummy keypair for read-only operations
  // For signing, we'll build unsigned transactions
  const dummyOwner = Keypair.generate();
  
  const raydium = await Raydium.load({
    connection,
    owner: dummyOwner,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: true, // We don't need token list
    blockhashCommitment: 'finalized',
  });
  
  console.log('[Raydium] SDK initialized');
  return raydium;
}

/**
 * Get Raydium connection (uses shared pool)
 */
export function getRaydiumConnection(): Connection {
  return getConnection();
}

/**
 * Reset client (for testing)
 */
export function resetRaydiumClient(): void {
  _raydiumClient = null;
  _initPromise = null;
}

// Raydium CLMM program IDs
export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
export const RAYDIUM_CLMM_PROGRAM_ID_DEVNET = new PublicKey('devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH');

// Default transaction version
export const TX_VERSION = TxVersion.V0;
