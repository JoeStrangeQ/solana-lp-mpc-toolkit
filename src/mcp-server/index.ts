/**
 * MCP Server Entry Point
 *
 * Runs as a separate process from the main HTTP server using stdio transport.
 * Exposes Solana LP toolkit capabilities as MCP tools for AI agents.
 * Imports service modules directly -- no dependency on the HTTP server.
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'solana-lp-toolkit',
  version: '1.0.0',
}, {
  instructions: 'Solana LP Toolkit MCP server. Provides tools for scanning Meteora DLMM pools, checking wallet balances, discovering LP positions, estimating LP parameters, and monitoring position health. All tools are read-only.',
});

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
