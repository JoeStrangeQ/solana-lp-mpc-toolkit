/**
 * MCP Tool Definitions
 *
 * Defines tool schemas and handlers for the Solana LP Toolkit MCP server.
 * All tools are read-only (v1) -- no write operations.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTopPools, type TopPoolsOptions } from '../services/pool-service.js';
import { getWalletBalance, getConnection } from '../services/wallet-service.js';
import { discoverAllPositions, getPoolInfo } from '../utils/position-discovery.js';
import { assessPositionRisk } from '../risk/index.js';

export function registerTools(server: McpServer): void {
  // ---- scan_pools ----
  server.tool(
    'scan_pools',
    'Scan for top Meteora DLMM liquidity pools, sorted and risk-assessed. Returns pool address, name, APR, TVL, risk score, Sharpe ratio, and strategy recommendations.',
    {
      sortBy: z.enum(['sharpe', 'apr', 'tvl', 'risk']).optional().describe('Sort order for pools (default: sharpe)'),
      limit: z.number().int().min(1).max(20).optional().describe('Max pools to return (default: 5)'),
      minTvl: z.number().optional().describe('Minimum TVL in USD (default: 100000)'),
      riskMax: z.number().int().min(1).max(10).optional().describe('Maximum risk score 1-10 (default: 10)'),
    },
    async (args) => {
      const options: TopPoolsOptions = {
        sortBy: args.sortBy ?? 'sharpe',
        limit: args.limit ?? 5,
        minTvl: args.minTvl ?? 100000,
        riskMax: args.riskMax ?? 10,
      };

      const result = await getTopPools(options);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: result.count,
            sortedBy: options.sortBy,
            pools: result.pools.map(p => ({
              address: p.poolAddress,
              name: p.poolName,
              apr: p.apr,
              tvl: p.tvl,
              volume24h: p.volume24h,
              binStep: p.binStep,
              riskScore: p.riskScore,
              ilRisk: p.ilRisk,
              sharpeRatio: p.sharpeRatio,
              recommendedBins: p.recommendedBins,
              recommendedStrategy: p.recommendedStrategy,
              warnings: p.warnings,
            })),
          }, null, 2),
        }],
      };
    },
  );

  // ---- get_positions ----
  server.tool(
    'get_positions',
    'Get all Meteora DLMM LP positions for a Solana wallet. Returns position addresses, pool info, bin/price ranges, token amounts, claimable fees, and in-range status.',
    {
      walletAddress: z.string().describe('Solana wallet address (base58)'),
    },
    async (args) => {
      const connection = getConnection();
      const positions = await discoverAllPositions(connection, args.walletAddress);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            walletAddress: args.walletAddress,
            totalPositions: positions.length,
            positions: positions.map(p => ({
              address: p.address,
              pool: {
                address: p.pool.address,
                name: p.pool.name,
                binStep: p.pool.binStep,
                tokenX: p.pool.tokenX.symbol,
                tokenY: p.pool.tokenY.symbol,
              },
              inRange: p.inRange,
              priceRange: p.priceRange,
              binRange: p.binRange,
              amounts: p.amounts,
              fees: {
                tokenX: p.fees.tokenXFormatted,
                tokenY: p.fees.tokenYFormatted,
              },
              solscanUrl: p.solscanUrl,
            })),
          }, null, 2),
        }],
      };
    },
  );

  // ---- get_wallet_balance ----
  server.tool(
    'get_wallet_balance',
    'Get SOL balance for a Solana wallet address.',
    {
      walletAddress: z.string().describe('Solana wallet address (base58)'),
    },
    async (args) => {
      const balance = await getWalletBalance(args.walletAddress);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            walletAddress: args.walletAddress,
            sol: balance.sol,
            lamports: balance.lamports,
          }, null, 2),
        }],
      };
    },
  );

  // ---- get_pool_info ----
  server.tool(
    'get_pool_info',
    'Get detailed on-chain info about a specific Meteora DLMM pool, including current price, active bin, tokens, and bin step.',
    {
      poolAddress: z.string().describe('Meteora DLMM pool address (base58)'),
    },
    async (args) => {
      const connection = getConnection();
      const info = await getPoolInfo(connection, args.poolAddress);

      if (!info) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Pool not found or failed to fetch' }),
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(info, null, 2),
        }],
      };
    },
  );

  // ---- estimate_lp ----
  server.tool(
    'estimate_lp',
    'Estimate LP position parameters for a Meteora DLMM pool. Returns suggested bin range, estimated token split, and fee tier info based on the strategy.',
    {
      poolAddress: z.string().describe('Meteora DLMM pool address (base58)'),
      amountSol: z.number().positive().describe('Amount of SOL to LP with'),
      strategy: z.enum(['concentrated', 'wide']).describe('LP strategy: concentrated (tight range, higher fees) or wide (wider range, lower IL risk)'),
    },
    async (args) => {
      const connection = getConnection();
      const info = await getPoolInfo(connection, args.poolAddress);

      if (!info) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Pool not found or failed to fetch' }),
          }],
          isError: true,
        };
      }

      // Calculate bin range based on strategy
      const binOffset = args.strategy === 'concentrated' ? 10 : 35;
      const minBinId = info.activeBinId - binOffset;
      const maxBinId = info.activeBinId + binOffset;
      const totalBins = maxBinId - minBinId + 1;

      // Estimate token split (roughly 50/50 when centered)
      const estimatedSolSide = args.amountSol / 2;
      const estimatedTokenSide = estimatedSolSide * info.currentPrice;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            pool: {
              address: args.poolAddress,
              name: info.name,
              binStep: info.binStep,
              currentPrice: info.displayPrice,
            },
            strategy: args.strategy,
            suggestedRange: {
              minBinId,
              maxBinId,
              totalBins,
              binOffset,
            },
            estimate: {
              totalSol: args.amountSol,
              solSide: estimatedSolSide,
              tokenYSide: `~${estimatedTokenSide.toFixed(2)} ${info.tokenY.symbol}`,
              note: 'Exact amounts depend on current bin distribution at execution time',
            },
            feeInfo: {
              binStep: info.binStep,
              feeRate: `${(info.binStep * 0.01).toFixed(2)}%`,
            },
          }, null, 2),
        }],
      };
    },
  );

  // ---- check_position_health ----
  server.tool(
    'check_position_health',
    'Check health and risk status of all LP positions for a wallet. Returns health score, in-range status, IL estimate, and recommended action (hold/monitor/rebalance/withdraw) for each position.',
    {
      walletAddress: z.string().describe('Solana wallet address (base58)'),
    },
    async (args) => {
      const connection = getConnection();
      const positions = await discoverAllPositions(connection, args.walletAddress);

      if (positions.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              walletAddress: args.walletAddress,
              message: 'No LP positions found for this wallet',
              positions: [],
            }, null, 2),
          }],
        };
      }

      const assessments = await Promise.all(
        positions.map(pos =>
          assessPositionRisk(
            pos.address,
            pos.pool.address,
            pos.pool.name,
            pos.activeBinId,
            pos.binRange.lower,
            pos.binRange.upper,
            pos.inRange ? undefined : new Date().toISOString(),
            pos.pool.tokenX.symbol,
          ),
        ),
      );

      assessments.sort((a, b) => a.healthScore - b.healthScore);

      const summary = {
        critical: assessments.filter(a => a.urgency === 'critical').length,
        high: assessments.filter(a => a.urgency === 'high').length,
        medium: assessments.filter(a => a.urgency === 'medium').length,
        low: assessments.filter(a => a.urgency === 'low').length,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            walletAddress: args.walletAddress,
            totalPositions: positions.length,
            summary,
            assessments: assessments.map(a => ({
              positionAddress: a.positionAddress,
              poolAddress: a.poolAddress,
              poolName: a.poolName,
              inRange: a.inRange,
              healthScore: a.healthScore,
              rangeUtilization: a.rangeUtilization,
              ilCurrent: `${a.ilCurrent}%`,
              ilProjected24h: `${a.ilProjected24h}%`,
              action: a.action,
              actionReason: a.actionReason,
              urgency: a.urgency,
            })),
          }, null, 2),
        }],
      };
    },
  );
}
