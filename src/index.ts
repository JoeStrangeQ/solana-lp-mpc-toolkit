/**
 * Solana LP MPC Toolkit
 * Privacy-preserving LP operations for AI agents
 *
 * @packageDocumentation
 */

// ============ API Layer ============
export * from "./api";

// ============ LP Toolkit Core ============

// Adapters
export {
  adapters,
  allAdapters,
  getAdapter,
  getAllAdapters,
} from "./lp-toolkit/adapters";

export type {
  DEXVenue,
  DEXAdapter,
  LPPool,
  LPPosition,
  TokenInfo,
  AddLiquidityIntent,
  RemoveLiquidityIntent,
  RebalanceIntent,
  LPStrategy,
  StrategyConfig,
  LPOperationResult,
  YieldScanResult,
} from "./lp-toolkit/adapters/types";

// Services
export {
  ArciumPrivacyService,
  ARCIUM_DEVNET_CONFIG,
  generatePrivacyKeys,
  deriveSharedSecret,
} from "./lp-toolkit/services/arciumPrivacy";

// Chat Interface
export { parseIntent } from "./lp-toolkit/api/intentParser";
export {
  formatForChat,
  createPositionCard,
} from "./lp-toolkit/api/chatDisplay";

// ============ Version ============
export const VERSION = "1.0.0";

// ============ Quick Start ============
/**
 * Quick start example:
 *
 * ```typescript
 * import { ArciumPrivacyService, adapters, parseIntent } from 'solana-lp-mpc-toolkit';
 *
 * // Parse user intent
 * const intent = parseIntent('Add $500 to SOL-USDC');
 *
 * // Initialize privacy service
 * const privacy = new ArciumPrivacyService(walletPubkey);
 * await privacy.initializeDevnet();
 *
 * // Encrypt strategy
 * const encrypted = privacy.encryptStrategy(intent);
 *
 * // Find best pool
 * const pools = await adapters.meteora.getPools(connection);
 * ```
 */
