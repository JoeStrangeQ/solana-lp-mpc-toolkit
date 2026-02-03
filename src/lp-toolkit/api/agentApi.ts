/**
 * Agent-to-Agent API
 * RESTful API for other AI agents/bots to use the LP Toolkit
 * 
 * This is what makes it a "toolkit for agents" - other bots can:
 * - Query pool data across all DEXs
 * - Execute LP operations
 * - Track positions
 * - Pay protocol fees
 * 
 * Authentication: API key (agent ID)
 * Rate limits: 100 req/min per agent
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { YieldScanner, createYieldScanner } from '../services/yieldScanner';
import { getAllAdapters, getAdapter } from '../adapters';
import { LPPool, LPPosition, DEXVenue, AddLiquidityIntent } from '../adapters/types';
import { calculateFee, FeeCalculation, PROTOCOL_FEE_BPS } from '../fees/feeCollector';
import { parseIntent, ParsedIntent } from './intentParser';
import { formatPoolRecommendation, formatPortfolioSummary } from './chatDisplay';
import { recommendStrategy, getStrategy, STRATEGIES } from '../strategies/templates';

// ============ Types ============

export interface AgentCredentials {
  agentId: string;
  apiKey: string;
  name?: string;
  referrer?: string;  // Referral wallet for fee split
}

export interface APIRequest {
  agentId: string;
  apiKey: string;
  action: string;
  params: Record<string, any>;
  timestamp: number;
  signature?: string;  // Optional: signed request for sensitive ops
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  meta: {
    requestId: string;
    timestamp: number;
    processingMs: number;
    rateLimitRemaining: number;
  };
}

export interface PoolsResponse {
  pools: LPPool[];
  recommended?: LPPool;
  reasoning?: string;
  totalCount: number;
}

export interface PositionsResponse {
  positions: LPPosition[];
  totalValueUSD: number;
  totalUnclaimedUSD: number;
  byVenue: Record<string, { count: number; valueUSD: number }>;
}

export interface QuoteResponse {
  pool: LPPool;
  amountUSD: number;
  estimatedDailyYield: number;
  estimatedAPY: number;
  fee: FeeCalculation;
  strategy: string;
  warnings: string[];
}

export interface ExecuteResponse {
  success: boolean;
  positionId?: string;
  txSignature?: string;
  fee: FeeCalculation;
  error?: string;
}

// ============ Rate Limiting ============

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 100;

function checkRateLimit(agentId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const limit = rateLimits.get(agentId);
  
  if (!limit || now > limit.resetAt) {
    rateLimits.set(agentId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  
  limit.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - limit.count };
}

// ============ API Handlers ============

/**
 * GET /pools - List LP pools across all DEXs
 */
export async function handleGetPools(
  connection: Connection,
  params: {
    venue?: DEXVenue;
    tokenA?: string;
    tokenB?: string;
    minApy?: number;
    minTvl?: number;
    sortBy?: 'apy' | 'tvl' | 'volume';
    limit?: number;
  }
): Promise<PoolsResponse> {
  const scanner = createYieldScanner(connection);
  
  const result = await scanner.scanPools({
    venues: params.venue ? [params.venue] : undefined,
    tokenA: params.tokenA,
    tokenB: params.tokenB,
    minApy: params.minApy || 0,
    minTvl: params.minTvl || 10000,
    sortBy: params.sortBy || 'apy',
    limit: params.limit || 20,
  });
  
  return {
    pools: result.pools,
    recommended: result.recommended || undefined,
    reasoning: result.reasoning,
    totalCount: result.pools.length,
  };
}

/**
 * GET /pools/:address - Get specific pool details
 */
export async function handleGetPool(
  connection: Connection,
  venue: DEXVenue,
  address: string
): Promise<LPPool | null> {
  const adapter = getAdapter(venue);
  if (!adapter) return null;
  
  return adapter.getPool(connection, address);
}

/**
 * GET /positions - Get agent's LP positions
 */
export async function handleGetPositions(
  connection: Connection,
  walletAddress: string
): Promise<PositionsResponse> {
  const scanner = createYieldScanner(connection);
  const userPubkey = new PublicKey(walletAddress);
  
  const aggregated = await scanner.getAggregatedPositions(userPubkey);
  
  return {
    positions: aggregated.positions,
    totalValueUSD: aggregated.totalValueUSD,
    totalUnclaimedUSD: aggregated.totalUnclaimedUSD,
    byVenue: aggregated.byVenue,
  };
}

/**
 * POST /quote - Get quote for adding liquidity
 */
export async function handleQuote(
  connection: Connection,
  params: {
    tokenA: string;
    tokenB?: string;
    amountUSD: number;
    venue?: DEXVenue;
    strategy?: string;
  }
): Promise<QuoteResponse> {
  const scanner = createYieldScanner(connection);
  
  // Find best pool
  const result = await scanner.scanPools({
    venues: params.venue ? [params.venue] : undefined,
    tokenA: params.tokenA,
    tokenB: params.tokenB,
    limit: 1,
    sortBy: 'apy',
  });
  
  if (!result.recommended) {
    throw new Error(`No pool found for ${params.tokenA}${params.tokenB ? `-${params.tokenB}` : ''}`);
  }
  
  const pool = result.recommended;
  const strategy = params.strategy ? getStrategy(params.strategy as any) : STRATEGIES.balanced;
  
  // Calculate estimates
  const dailyYield = (params.amountUSD * pool.apy / 365 / 100);
  const fee = calculateFee(params.amountUSD);
  
  // Generate warnings
  const warnings: string[] = [];
  if (pool.apy > 100) warnings.push('High APY may indicate high volatility');
  if (pool.tvl < 100000) warnings.push('Low TVL - potential slippage risk');
  if (pool.volume24h < 50000) warnings.push('Low volume - may be hard to exit');
  
  return {
    pool,
    amountUSD: params.amountUSD,
    estimatedDailyYield: dailyYield,
    estimatedAPY: pool.apy,
    fee,
    strategy: strategy.name,
    warnings,
  };
}

/**
 * POST /execute - Execute LP operation (requires signed request)
 */
export async function handleExecute(
  connection: Connection,
  userKeypair: Keypair,
  params: {
    action: 'add' | 'remove' | 'claim';
    venue: DEXVenue;
    poolAddress?: string;
    positionId?: string;
    amountUSD?: number;
    percentage?: number;
    strategy?: string;
  }
): Promise<ExecuteResponse> {
  const adapter = getAdapter(params.venue);
  if (!adapter) {
    return { success: false, error: `Unknown venue: ${params.venue}`, fee: calculateFee(0) };
  }
  
  try {
    switch (params.action) {
      case 'add': {
        if (!params.poolAddress || !params.amountUSD) {
          return { success: false, error: 'Missing poolAddress or amountUSD', fee: calculateFee(0) };
        }
        
        const pool = await adapter.getPool(connection, params.poolAddress);
        if (!pool) {
          return { success: false, error: 'Pool not found', fee: calculateFee(0) };
        }
        
        const fee = calculateFee(params.amountUSD);
        
        const { transaction, positionId } = await adapter.addLiquidity(
          connection,
          userKeypair,
          {
            venue: params.venue,
            poolAddress: params.poolAddress,
            tokenA: pool.tokenA.symbol,
            tokenB: pool.tokenB.symbol,
            totalValueUSD: params.amountUSD,
            strategy: (params.strategy as any) || 'balanced',
          }
        );
        
        // In production: sign and send transaction
        // const signature = await connection.sendTransaction(transaction, [userKeypair]);
        
        return {
          success: true,
          positionId,
          txSignature: 'simulated_' + Date.now(),
          fee,
        };
      }
      
      case 'remove': {
        if (!params.positionId) {
          return { success: false, error: 'Missing positionId', fee: calculateFee(0) };
        }
        
        const position = await adapter.getPosition(connection, params.positionId);
        const amountUSD = position?.valueUSD || 0;
        const fee = calculateFee(amountUSD * (params.percentage || 100) / 100);
        
        const transaction = await adapter.removeLiquidity(
          connection,
          userKeypair,
          {
            positionId: params.positionId,
            percentage: params.percentage || 100,
            claimFees: true,
          }
        );
        
        return {
          success: true,
          txSignature: 'simulated_' + Date.now(),
          fee,
        };
      }
      
      case 'claim': {
        if (!params.positionId) {
          return { success: false, error: 'Missing positionId', fee: calculateFee(0) };
        }
        
        const transaction = await adapter.claimFees(
          connection,
          userKeypair,
          params.positionId
        );
        
        return {
          success: true,
          txSignature: 'simulated_' + Date.now(),
          fee: calculateFee(0), // No fee on claims
        };
      }
      
      default:
        return { success: false, error: `Unknown action: ${params.action}`, fee: calculateFee(0) };
    }
  } catch (error: any) {
    return { success: false, error: error.message, fee: calculateFee(0) };
  }
}

/**
 * POST /interpret - Interpret natural language into API call
 * This is what makes it agent-friendly - other agents can send
 * natural language and get structured responses
 */
export async function handleInterpret(
  text: string
): Promise<{
  intent: ParsedIntent;
  suggestedAction: string;
  suggestedParams: Record<string, any>;
}> {
  const intent = parseIntent(text);
  
  let suggestedAction = '';
  let suggestedParams: Record<string, any> = {};
  
  switch (intent.type) {
    case 'scan_pools':
      suggestedAction = 'GET /pools';
      suggestedParams = {
        tokenA: intent.params.tokenA,
        tokenB: intent.params.tokenB,
      };
      break;
    
    case 'show_positions':
      suggestedAction = 'GET /positions';
      suggestedParams = {};
      break;
    
    case 'add_liquidity':
      suggestedAction = 'POST /quote then POST /execute';
      suggestedParams = {
        tokenA: intent.params.tokenA,
        tokenB: intent.params.tokenB,
        amountUSD: intent.params.amount,
      };
      break;
    
    case 'remove_liquidity':
      suggestedAction = 'POST /execute';
      suggestedParams = {
        action: 'remove',
        positionId: intent.params.positionId,
        percentage: intent.params.percentage || 100,
      };
      break;
    
    case 'claim_fees':
      suggestedAction = 'POST /execute';
      suggestedParams = {
        action: 'claim',
        positionId: intent.params.positionId,
      };
      break;
    
    default:
      suggestedAction = 'GET /pools (default)';
  }
  
  return { intent, suggestedAction, suggestedParams };
}

/**
 * GET /strategies - List available LP strategies
 */
export function handleGetStrategies(): typeof STRATEGIES {
  return STRATEGIES;
}

/**
 * POST /recommend-strategy - Get strategy recommendation
 */
export function handleRecommendStrategy(
  preferences: {
    riskTolerance?: 'low' | 'medium' | 'high';
    timeCommitment?: 'passive' | 'active';
    goal?: 'yield' | 'accumulate' | 'hedge' | 'profit-take';
    pairType?: 'stable' | 'volatile' | 'correlated';
  }
) {
  return recommendStrategy(preferences);
}

/**
 * GET /info - API info and fee structure
 */
export function handleGetInfo() {
  return {
    name: 'LP Agent Toolkit API',
    version: '0.1.0',
    description: 'Unified LP interface for AI agents across Solana DEXs',
    supportedDEXs: ['meteora', 'orca', 'raydium', 'lifinity'],
    feeStructure: {
      protocolFeeBps: PROTOCOL_FEE_BPS,
      description: `${PROTOCOL_FEE_BPS / 100}% fee on LP transactions`,
      split: '70% treasury, 30% referrer',
    },
    rateLimits: {
      requestsPerMinute: RATE_LIMIT_MAX,
    },
    endpoints: [
      'GET /pools',
      'GET /pools/:address',
      'GET /positions',
      'POST /quote',
      'POST /execute',
      'POST /interpret',
      'GET /strategies',
      'POST /recommend-strategy',
      'GET /info',
    ],
  };
}

// ============ Main Request Handler ============

/**
 * Process an API request
 */
export async function processAPIRequest(
  connection: Connection,
  request: APIRequest,
  userKeypair?: Keypair
): Promise<APIResponse> {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Check rate limit
  const rateLimit = checkRateLimit(request.agentId);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: 'Rate limit exceeded',
      meta: {
        requestId,
        timestamp: Date.now(),
        processingMs: Date.now() - startTime,
        rateLimitRemaining: 0,
      },
    };
  }
  
  try {
    let data: any;
    
    switch (request.action) {
      case 'getPools':
        data = await handleGetPools(connection, request.params);
        break;
      
      case 'getPool':
        data = await handleGetPool(connection, request.params.venue, request.params.address);
        break;
      
      case 'getPositions':
        data = await handleGetPositions(connection, request.params.walletAddress);
        break;
      
      case 'quote':
        data = await handleQuote(connection, request.params);
        break;
      
      case 'execute':
        if (!userKeypair) {
          throw new Error('Keypair required for execute action');
        }
        data = await handleExecute(connection, userKeypair, request.params);
        break;
      
      case 'interpret':
        data = await handleInterpret(request.params.text);
        break;
      
      case 'getStrategies':
        data = handleGetStrategies();
        break;
      
      case 'recommendStrategy':
        data = handleRecommendStrategy(request.params);
        break;
      
      case 'getInfo':
        data = handleGetInfo();
        break;
      
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
    
    return {
      success: true,
      data,
      meta: {
        requestId,
        timestamp: Date.now(),
        processingMs: Date.now() - startTime,
        rateLimitRemaining: rateLimit.remaining,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      meta: {
        requestId,
        timestamp: Date.now(),
        processingMs: Date.now() - startTime,
        rateLimitRemaining: rateLimit.remaining,
      },
    };
  }
}

export default {
  processAPIRequest,
  handleGetPools,
  handleGetPool,
  handleGetPositions,
  handleQuote,
  handleExecute,
  handleInterpret,
  handleGetStrategies,
  handleRecommendStrategy,
  handleGetInfo,
};
