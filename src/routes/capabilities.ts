/**
 * Capabilities Endpoint
 * 
 * Showcases all features of the LP Agent Toolkit for demos and discovery
 */
import { Hono } from 'hono';

const app = new Hono();

interface Capability {
  name: string;
  description: string;
  endpoint?: string;
  botCommand?: string;
  status: 'live' | 'beta' | 'planned';
}

interface CapabilitiesResponse {
  name: string;
  version: string;
  description: string;
  dexSupport: {
    meteora: { status: string; features: string[] };
    orca: { status: string; features: string[] };
    raydium: { status: string; features: string[] };
  };
  capabilities: Capability[];
  telegramBot: string;
  apiBase: string;
  github: string;
}

app.get('/', (c) => {
  const capabilities: CapabilitiesResponse = {
    name: 'MnM LP Agent Toolkit',
    version: '1.0.0',
    description: 'AI-native liquidity provisioning toolkit for Solana DEXes with MPC wallet security and MEV protection',
    
    dexSupport: {
      meteora: {
        status: '✅ Full Support',
        features: [
          'DLMM concentrated liquidity',
          'Atomic swap-to-LP via Jito bundles',
          'Position monitoring with alerts',
          'Auto-rebalance recommendations',
          'Fee claiming and compounding',
        ],
      },
      orca: {
        status: '✅ Full Support',
        features: [
          'Whirlpool CLMM positions',
          'Tick-aligned liquidity ranges',
          'Position discovery and tracking',
          'Integrated with unified interface',
        ],
      },
      raydium: {
        status: '✅ Full Support',
        features: [
          'CLMM concentrated liquidity',
          'Direct API integration',
          'Pool discovery with APR data',
          'Position value tracking',
        ],
      },
    },

    capabilities: [
      // Core LP Operations
      {
        name: 'Atomic LP Entry',
        description: 'Swap any token to LP position in one MEV-protected Jito bundle',
        endpoint: 'POST /lp/atomic',
        botCommand: '/lp',
        status: 'live',
      },
      {
        name: 'LP Withdrawal',
        description: 'Withdraw liquidity with optional swap back to single token',
        endpoint: 'POST /lp/withdraw',
        botCommand: '/withdraw',
        status: 'live',
      },
      {
        name: 'Position Monitoring',
        description: 'Real-time tracking with out-of-range alerts via Telegram/webhook',
        endpoint: 'GET /positions',
        botCommand: '/positions',
        status: 'live',
      },
      
      // Portfolio Management
      {
        name: 'Portfolio Dashboard',
        description: 'Aggregate portfolio across all DEXes with USD values',
        endpoint: 'GET /portfolio/:wallet',
        botCommand: '/portfolio',
        status: 'live',
      },
      {
        name: 'Pool Discovery',
        description: 'Find best yield pools across Meteora, Orca, Raydium',
        endpoint: 'GET /unified/pools',
        botCommand: '/pools',
        status: 'live',
      },
      {
        name: 'IL Calculator',
        description: 'Impermanent loss estimation for positions',
        botCommand: '/positions (inline)',
        status: 'live',
      },
      
      // Automation
      {
        name: 'Auto-Rebalance',
        description: 'Analyzes positions and recommends rebalancing when out of range',
        botCommand: '/rebalance',
        status: 'live',
      },
      {
        name: 'DCA into LP',
        description: 'Dollar-cost-average into LP positions over time',
        botCommand: '/dca',
        status: 'live',
      },
      {
        name: 'Notification Preferences',
        description: 'Configure alert thresholds and quiet hours',
        botCommand: '/notifications',
        status: 'live',
      },
      
      // Security & Infrastructure
      {
        name: 'MPC Wallets',
        description: 'Privy embedded wallets with MPC signing (no exposed keys)',
        endpoint: 'POST /wallet/create',
        status: 'live',
      },
      {
        name: 'MEV Protection',
        description: 'Jito bundles prevent sandwich attacks on LP operations',
        status: 'live',
      },
      {
        name: 'Multi-Oracle Pricing',
        description: 'Pyth Hermes + Jupiter price aggregation with fallback',
        status: 'live',
      },
      {
        name: 'Circuit Breakers',
        description: 'Auto-disable failing services to prevent cascading failures',
        endpoint: 'GET /health/circuit-breakers',
        status: 'live',
      },
      
      // Agent Interop
      {
        name: 'MCP Server',
        description: '13 tools for AI agent interoperability via Model Context Protocol',
        status: 'live',
      },
      {
        name: 'Solana Actions',
        description: 'Shareable executable URLs (Blinks) for LP operations',
        endpoint: 'GET /actions/*',
        status: 'live',
      },
    ],

    telegramBot: 'https://t.me/mnm_lp_bot',
    apiBase: 'https://lp-agent-api-production.up.railway.app',
    github: 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit',
  };

  return c.json(capabilities);
});

export default app;
