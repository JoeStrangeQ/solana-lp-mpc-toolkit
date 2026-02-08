/**
 * Solana RPC Connection Pool
 * 
 * Provides a shared Connection instance to reduce overhead.
 * The @solana/web3.js Connection class already handles:
 * - HTTP keep-alive for REST calls
 * - WebSocket connection reuse for subscriptions
 * 
 * By sharing a single instance, we:
 * - Reduce connection setup overhead
 * - Share WebSocket subscriptions (if any)
 * - Maintain consistent configuration
 */

import { Connection, Commitment } from '@solana/web3.js';
import { config } from '../config/index.js';

// Default commitment level for LP operations
// Using 'finalized' for Privy RPC compatibility
const DEFAULT_COMMITMENT: Commitment = 'finalized';

// Singleton connection instance
let sharedConnection: Connection | null = null;

/**
 * Get the shared RPC connection.
 * Creates a new connection on first call, reuses on subsequent calls.
 * 
 * @param commitment - Optional commitment level override
 * @returns Shared Connection instance
 */
export function getConnection(commitment?: Commitment): Connection {
  if (!sharedConnection) {
    const rpcUrl = config.solana?.rpc || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    
    sharedConnection = new Connection(rpcUrl, {
      commitment: commitment || DEFAULT_COMMITMENT,
      // Connection config for optimal performance
      confirmTransactionInitialTimeout: 60000,
      disableRetryOnRateLimit: false,
    });
    
    console.log(`[ConnectionPool] Created shared connection to ${rpcUrl.slice(0, 30)}...`);
  }
  
  return sharedConnection;
}

/**
 * Get a fresh connection (for one-off operations that need isolation)
 * Use sparingly - prefer getConnection() for most operations.
 */
export function createConnection(commitment?: Commitment): Connection {
  const rpcUrl = config.solana?.rpc || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, commitment || DEFAULT_COMMITMENT);
}

/**
 * Reset the shared connection (for testing or after errors)
 */
export function resetConnection(): void {
  sharedConnection = null;
  console.log('[ConnectionPool] Connection reset');
}

/**
 * Get connection stats
 */
export function getConnectionStats(): {
  initialized: boolean;
  rpcEndpoint: string;
  commitment: Commitment;
} {
  if (!sharedConnection) {
    return {
      initialized: false,
      rpcEndpoint: config.solana?.rpc || 'not configured',
      commitment: DEFAULT_COMMITMENT,
    };
  }
  
  return {
    initialized: true,
    rpcEndpoint: sharedConnection.rpcEndpoint.slice(0, 50) + '...',
    commitment: sharedConnection.commitment,
  };
}
