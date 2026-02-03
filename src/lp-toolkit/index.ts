/**
 * LP Agent Toolkit
 * Unified interface for AI agents to manage LP positions across Solana DEXs
 * 
 * Features:
 * - Multi-DEX support (Meteora, Orca, Raydium, Phoenix)
 * - Arcium privacy layer for strategy encryption
 * - Natural language intent parsing
 * - Agent-native chat display
 * - Protocol fee collection
 */

// ============ Adapters ============
export * from './adapters/types';
export { default as meteoraAdapter } from './adapters/meteora';
export { default as orcaAdapter } from './adapters/orca';
export { default as raydiumAdapter } from './adapters/raydium';
export { getAllAdapters, getAdapter, adapters } from './adapters';

// ============ Services ============
export { YieldScanner, createYieldScanner } from './services/yieldScanner';
export { ArciumPrivacyService, generatePrivacyKeys } from './services/arciumPrivacy';
export { PrivateExecutor } from './services/privateExecutor';
export { YieldMonitor, createYieldMonitor } from './services/yieldMonitor';
export type { YieldUpdate, MonitorConfig } from './services/yieldMonitor';

// ============ API Layer ============
// Chat commands
export { processCommand, parseCommand } from './api/chatCommands';
export type { ChatContext, CommandResult, PendingAction } from './api/chatCommands';

// Intent parsing (natural language)
export { parseIntent, isLPRelated, suggestResponse } from './api/intentParser';
export type { ParsedIntent, IntentType } from './api/intentParser';

// Chat display (agent-native)
export {
  formatUSD,
  formatDailyEarnings,
  describeAPY,
  formatVenue,
  formatPoolForAgent,
  formatPoolRecommendation,
  formatPositionForAgent,
  formatPortfolioSummary,
  formatOperationResult,
} from './api/chatDisplay';

// ============ Strategies ============
export {
  STRATEGIES,
  recommendStrategy,
  getStrategy,
  listStrategies,
  applyStrategy,
  needsRebalance,
  formatStrategyForChat,
  formatStrategyMenu,
} from './strategies/templates';
export type { StrategyTemplate, StrategyRecommendation } from './strategies/templates';

// ============ Fee Collection ============
export {
  PROTOCOL_FEE_BPS,
  TREASURY_SPLIT,
  REFERRER_SPLIT,
  calculateFee,
  shouldCollectFee,
  createFeeCollectionIx,
  createFeeReceipt,
  FeeCollector,
} from './fees/feeCollector';
export type { FeeCalculation, FeeReceipt } from './fees/feeCollector';

// ============ Key Types ============
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

// ============ Constants ============
export const VERSION = '0.1.0';
export const SUPPORTED_VENUES = ['meteora', 'orca', 'raydium', 'phoenix'] as const;

/**
 * Quick start example:
 * 
 * ```typescript
 * import { 
 *   createYieldScanner, 
 *   parseIntent,
 *   formatPoolRecommendation,
 *   FeeCollector 
 * } from './lp-toolkit';
 * 
 * // Natural language parsing
 * const intent = parseIntent("put 2 SOL to work");
 * // { type: 'add_liquidity', params: { amount: 400, tokenA: 'SOL' } }
 * 
 * // Scan for best pools
 * const scanner = createYieldScanner(connection);
 * const { pools, recommended } = await scanner.scanPools({
 *   tokenA: intent.params.tokenA,
 *   minApy: 10,
 * });
 * 
 * // Format for chat (agent-native)
 * const message = formatPoolRecommendation(pools, intent.params.amount);
 * // "🥇 Meteora SOL-USDC - 45% APY → ~$1.80/day"
 * 
 * // Calculate fee
 * const feeCalc = calculateFee(intent.params.amount);
 * // { feeAmountUSD: 0.40, ... }
 * ```
 */
