/**
 * MCP Server for LP Agent Toolkit
 *
 * Exposes core toolkit functionality as MCP tools via stdio transport.
 * Allows any MCP-compatible AI agent to interact with the toolkit.
 *
 * Usage:
 *   node dist/mcp-server/index.js
 *
 * Configure in Claude Desktop / Cursor:
 *   {
 *     "mcpServers": {
 *       "solana-lp-toolkit": {
 *         "command": "node",
 *         "args": ["dist/mcp-server/index.js"],
 *         "cwd": "/path/to/solana-lp-mpc-toolkit"
 *       }
 *     }
 *   }
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from '../config/index.js';

// Internal API base URL - defaults to local server
const API_BASE = process.env.LP_AGENT_API_URL || `http://localhost:${config.agent.port}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiCall(path: string, options?: RequestInit): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  return resp.json();
}

// ---------------------------------------------------------------------------
// MCP Server Setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'lp-agent-toolkit',
  version: '3.0.0',
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource(
  'toolkit-info',
  'toolkit://info',
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(await apiCall('/'), null, 2),
    }],
  }),
);

server.resource(
  'pool-by-address',
  new ResourceTemplate('pool://{address}', { list: undefined }),
  async (uri, params) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(await apiCall(`/pools/${params.address}/risk`), null, 2),
    }],
  }),
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.tool(
  'scan_pools',
  'Scan for liquidity pools on Meteora DLMM. Returns pools matching the token pair with APR, TVL, volume, and risk scores.',
  {
    tokenA: z.string().describe('Token A symbol (e.g. SOL) or mint address'),
    tokenB: z.string().describe('Token B symbol (e.g. USDC) or mint address'),
    sortBy: z.enum(['apr', 'tvl', 'volume']).optional().describe('Sort results by metric'),
  },
  async ({ tokenA, tokenB, sortBy }) => {
    let path = `/pools/scan?tokenA=${tokenA}&tokenB=${tokenB}`;
    if (sortBy) path += `&sortBy=${sortBy}`;
    const result = await apiCall(path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_top_pools',
  'Get top-ranked liquidity pools by risk-adjusted returns.',
  {
    limit: z.number().optional().describe('Max number of pools to return (default 5)'),
    riskMax: z.number().optional().describe('Maximum risk score (1-10, default 7)'),
  },
  async ({ limit, riskMax }) => {
    let path = '/pools/top?';
    if (limit) path += `limit=${limit}&`;
    if (riskMax) path += `riskMax=${riskMax}`;
    const result = await apiCall(path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_pool_risk',
  'Get risk assessment for a specific pool.',
  {
    poolAddress: z.string().describe('Pool address (Meteora DLMM pool)'),
  },
  async ({ poolAddress }) => {
    const result = await apiCall(`/pools/${poolAddress}/risk`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'create_wallet',
  'Create a new MPC-secured wallet via Privy embedded wallets.',
  {},
  async () => {
    const result = await apiCall('/wallet/create', { method: 'POST' });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_balance',
  'Get wallet balance including SOL and token holdings.',
  {
    walletId: z.string().describe('Privy wallet ID'),
  },
  async ({ walletId }) => {
    const result = await apiCall(`/wallet/${walletId}/balance`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_positions',
  'List all LP positions for a wallet with token names and current prices.',
  {
    walletId: z.string().describe('Privy wallet ID or wallet address'),
  },
  async ({ walletId }) => {
    const result = await apiCall(`/positions/${walletId}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'execute_lp',
  'Execute a full LP pipeline: swap collateral into pool tokens and add concentrated liquidity.',
  {
    walletId: z.string().describe('Privy wallet ID'),
    poolAddress: z.string().describe('Pool address to LP into'),
    amount: z.number().describe('Amount of SOL to use'),
    strategy: z.enum(['concentrated', 'wide']).optional().describe('Liquidity strategy'),
  },
  async ({ walletId, poolAddress, amount, strategy }) => {
    const result = await apiCall('/lp/execute', {
      method: 'POST',
      body: JSON.stringify({ walletId, poolAddress, amount, strategy: strategy || 'concentrated' }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'withdraw_position',
  'Withdraw liquidity from an LP position with PnL calculation.',
  {
    walletAddress: z.string().describe('Wallet address'),
    poolAddress: z.string().describe('Pool address'),
    positionAddress: z.string().describe('Position address to withdraw from'),
  },
  async ({ walletAddress, poolAddress, positionAddress }) => {
    const result = await apiCall('/lp/withdraw', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, poolAddress, positionAddress }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_oracle_price',
  'Get aggregated price from Pyth and Jupiter oracles with confidence and divergence data.',
  {
    mint: z.string().describe('Token mint address'),
  },
  async ({ mint }) => {
    const result = await apiCall(`/oracle/price?mint=${mint}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'ultra_swap_order',
  'Create a MEV-protected swap order via Jupiter Ultra V3. Returns unsigned transaction for signing.',
  {
    inputToken: z.string().describe('Input token symbol or mint'),
    outputToken: z.string().describe('Output token symbol or mint'),
    amount: z.number().describe('Amount in base units'),
    walletAddress: z.string().describe('Taker wallet address'),
    slippageBps: z.number().optional().describe('Slippage tolerance in bps (default 100)'),
  },
  async ({ inputToken, outputToken, amount, walletAddress, slippageBps }) => {
    const result = await apiCall('/ultra/order', {
      method: 'POST',
      body: JSON.stringify({ inputToken, outputToken, amount, walletAddress, slippageBps }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'claim_fees',
  'Claim accumulated trading fees from an LP position.',
  {
    walletAddress: z.string().describe('Wallet address'),
    poolAddress: z.string().describe('Pool address'),
    positionAddress: z.string().describe('Position address'),
  },
  async ({ walletAddress, poolAddress, positionAddress }) => {
    const result = await apiCall('/fees/claim', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, poolAddress, positionAddress }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'rebalance_position',
  'Prepare an atomic rebalance: withdraw from current range and re-enter at optimal range.',
  {
    walletId: z.string().describe('Privy wallet ID'),
    poolAddress: z.string().describe('Pool address'),
    positionAddress: z.string().describe('Current position address'),
    strategy: z.enum(['concentrated', 'wide']).optional().describe('New range strategy'),
  },
  async ({ walletId, poolAddress, positionAddress, strategy }) => {
    const result = await apiCall('/lp/rebalance', {
      method: 'POST',
      body: JSON.stringify({ walletId, poolAddress, positionAddress, strategy: strategy || 'concentrated' }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'chat',
  'Send a natural language message to the LP Agent for analysis and action suggestions.',
  {
    message: z.string().describe('Natural language message'),
    walletId: z.string().optional().describe('Optional wallet context'),
  },
  async ({ message, walletId }) => {
    const result = await apiCall('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, walletId }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] LP Agent Toolkit MCP Server running on stdio');
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
