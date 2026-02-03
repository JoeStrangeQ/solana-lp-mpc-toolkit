/**
 * LP Agent Toolkit
 * Unified interface for AI agents to manage LP positions across Solana DEXs
 * 
 * Features:
 * - Multi-DEX support (Meteora, Orca, Raydium, Phoenix)
 * - Arcium privacy layer for strategy encryption
 * - Chat-native interface
 * - Bot-to-bot fee model
 */

// Adapters
export * from './adapters/types';
export { default as meteoraAdapter } from './adapters/meteora';

// Services
export { YieldScanner, createYieldScanner } from './services/yieldScanner';
export { ArciumPrivacyService, generatePrivacyKeys } from './services/arciumPrivacy';

// Chat Commands
export { processCommand, parseCommand } from './api/chatCommands';
export type { ChatContext, CommandResult, PendingAction } from './api/chatCommands';

// Re-export key types
export type {
  DEXVenue,
  LPPool,
  LPPosition,
  AddLiquidityIntent,
  RemoveLiquidityIntent,
  LPStrategy,
  LPOperationResult,
  YieldScanResult,
} from './adapters/types';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { createYieldScanner, meteoraAdapter } from './lp-toolkit';
 * 
 * const scanner = createYieldScanner(connection);
 * 
 * // Scan for best SOL-USDC pools
 * const { pools, recommended } = await scanner.scanPools({
 *   tokenA: 'SOL',
 *   tokenB: 'USDC',
 *   minApy: 10,
 *   sortBy: 'apy'
 * });
 * 
 * // Get user positions
 * const positions = await scanner.getAggregatedPositions(userPubkey);
 * 
 * // Add liquidity to Meteora
 * const { transaction, positionAddress } = await meteoraAdapter.addLiquidity({
 *   connection,
 *   user: keypair,
 *   poolAddress: recommended.address,
 *   tokenXAmount: 1000000000, // 1 SOL in lamports
 *   tokenYAmount: 100000000,  // 100 USDC in smallest unit
 * });
 * ```
 */

// Version
export const VERSION = '0.1.0';
export const SUPPORTED_VENUES = ['meteora', 'orca', 'raydium', 'phoenix'] as const;
