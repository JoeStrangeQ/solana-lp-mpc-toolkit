/**
 * API Documentation
 * OpenAPI-style endpoint descriptions for AI agents
 */

export const apiDocs = {
  openapi: "3.0.0",
  info: {
    title: "Solana LP MPC Toolkit API",
    version: "1.0.0",
    description: `
Privacy-preserving LP operations for AI agents on Solana.

## Features
- **Multi-DEX Support**: Meteora, Orca, Raydium, and more
- **Privacy Layer**: Arcium encryption for strategy parameters
- **Agent-First Design**: Wallet-less operation, unsigned transactions
- **Production Ready**: Rate limiting, health checks, structured logging

## Authentication
Currently no authentication required. Rate limited by IP.

## Rate Limits
- Standard endpoints: 100 requests/minute
- Transaction endpoints: 10 requests/minute
- Read-only endpoints: 200 requests/minute
    `.trim(),
  },
  servers: [
    { url: "http://localhost:3456", description: "Local development" },
  ],
  paths: {
    "/": {
      get: {
        summary: "API Info",
        description: "Returns basic API information and links",
        responses: {
          "200": {
            description: "API info object",
            content: {
              "application/json": {
                example: {
                  name: "Solana LP MPC Toolkit API",
                  version: "1.0.0",
                  docs: "/v1/docs",
                },
              },
            },
          },
        },
      },
    },
    "/v1/health": {
      get: {
        summary: "Quick Health Check",
        description: "Fast health check for load balancers. Returns memory usage and rate limit stats.",
        responses: {
          "200": {
            description: "Health status",
            content: {
              "application/json": {
                example: {
                  status: "healthy",
                  timestamp: "2026-02-03T07:00:00Z",
                  version: "1.0.0",
                  uptime: 3600,
                },
              },
            },
          },
        },
      },
    },
    "/v1/health/deep": {
      get: {
        summary: "Deep Health Check",
        description: "Comprehensive health check including external dependencies (Solana RPC, DEX APIs)",
        responses: {
          "200": { description: "All systems healthy" },
          "503": { description: "One or more dependencies unhealthy" },
        },
      },
    },
    "/v1/pools/scan": {
      get: {
        summary: "Scan LP Pools",
        description: "Discover LP opportunities across multiple DEXs. Returns pools sorted by APY.",
        parameters: [
          { name: "tokenA", in: "query", description: "First token symbol (e.g., SOL)", schema: { type: "string", default: "SOL" } },
          { name: "tokenB", in: "query", description: "Second token symbol (e.g., USDC)", schema: { type: "string", default: "USDC" } },
          { name: "venue", in: "query", description: "Filter by DEX (meteora, orca)", schema: { type: "string" } },
          { name: "limit", in: "query", description: "Max pools to return", schema: { type: "integer", default: 10 } },
        ],
        responses: {
          "200": {
            description: "List of pools with APY, TVL, and volume",
            content: {
              "application/json": {
                example: {
                  success: true,
                  count: 2,
                  pools: [
                    { venue: "meteora", name: "SOL-USDC", apy: 45.2, tvl: 12500000 },
                  ],
                  chatDisplay: "**1. SOL-USDC** [meteora]\n├ APY: 45.2%...",
                },
              },
            },
          },
        },
      },
    },
    "/v1/intent/parse": {
      post: {
        summary: "Parse Natural Language Intent",
        description: "Convert natural language to structured LP intent. Useful for chat-based agents.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  text: { type: "string", description: "Natural language command" },
                },
                required: ["text"],
              },
              example: { text: "Add $500 to best SOL-USDC pool" },
            },
          },
        },
        responses: {
          "200": {
            description: "Parsed intent",
            content: {
              "application/json": {
                example: {
                  success: true,
                  intent: {
                    action: "add_liquidity",
                    tokenA: "SOL",
                    tokenB: "USDC",
                    totalValueUSD: 500,
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/encrypt/strategy": {
      post: {
        summary: "Encrypt Strategy (Arcium)",
        description: "Encrypt LP strategy parameters using Arcium MPC for privacy-preserving execution.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ownerPubkey: { type: "string", description: "Solana wallet address" },
                  strategy: { type: "object", description: "Strategy parameters to encrypt" },
                },
                required: ["ownerPubkey", "strategy"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Encrypted strategy blob",
            content: {
              "application/json": {
                example: {
                  success: true,
                  encrypted: {
                    ciphertext: "base64...",
                    nonce: "base64...",
                    publicKey: "base64...",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/positions/{wallet}": {
      get: {
        summary: "Get LP Positions",
        description: "Retrieve all LP positions for a wallet across supported DEXs.",
        parameters: [
          { name: "wallet", in: "path", required: true, description: "Solana wallet address", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "List of positions with values and fees",
          },
        },
      },
    },
    "/v1/tx/add-liquidity": {
      post: {
        summary: "Build Add Liquidity Transaction",
        description: "Build an unsigned transaction for adding liquidity. Agent can forward to user for signing.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  userPubkey: { type: "string", description: "User's wallet address (fee payer)" },
                  poolAddress: { type: "string", description: "Target pool address" },
                  venue: { type: "string", description: "DEX venue (meteora, orca)" },
                  tokenA: { type: "string", description: "First token symbol" },
                  tokenB: { type: "string", description: "Second token symbol" },
                  amountA: { type: "number", description: "Amount of tokenA" },
                  amountB: { type: "number", description: "Amount of tokenB" },
                  slippageBps: { type: "integer", description: "Slippage tolerance in basis points", default: 50 },
                },
                required: ["userPubkey", "poolAddress", "venue", "tokenA", "tokenB", "amountA", "amountB"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Unsigned transaction ready for signing",
            content: {
              "application/json": {
                example: {
                  success: true,
                  transaction: {
                    serialized: "base64...",
                    message: "Add 10 SOL + 1500 USDC to meteora",
                    estimatedFee: 0.000005,
                    expiresAt: 123456789,
                  },
                  instructions: ["Create SOL token account", "Add liquidity"],
                },
              },
            },
          },
        },
      },
    },
    "/v1/tx/remove-liquidity": {
      post: {
        summary: "Build Remove Liquidity Transaction",
        description: "Build an unsigned transaction for removing liquidity from a position.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  userPubkey: { type: "string" },
                  positionId: { type: "string" },
                  venue: { type: "string" },
                  percentage: { type: "integer", default: 100 },
                },
                required: ["userPubkey", "positionId", "venue"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Unsigned transaction" },
        },
      },
    },
    "/v1/tx/describe": {
      post: {
        summary: "Describe Transaction",
        description: "Get human-readable description of what a serialized transaction will do.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  serializedTx: { type: "string", description: "Base64 encoded transaction" },
                },
                required: ["serializedTx"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Transaction description",
            content: {
              "application/json": {
                example: {
                  success: true,
                  description: "Add 10 SOL + 1500 USDC to meteora pool HJPj...",
                },
              },
            },
          },
        },
      },
    },
  },
};

export default apiDocs;
