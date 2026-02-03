/**
 * LP Agent Toolkit Configuration
 */

export const config = {
  // Hummingbot Gateway
  gateway: {
    url: process.env.GATEWAY_URL || 'http://localhost:15888',
    network: process.env.SOLANA_NETWORK || 'mainnet-beta',
  },

  // Portal MPC
  portal: {
    apiUrl: process.env.PORTAL_API_URL || 'https://mpc-client.portalhq.io',
    apiKey: process.env.PORTAL_API_KEY || '',
    useMock: process.env.USE_MOCK_MPC === 'true',
  },

  // Arcium Privacy
  arcium: {
    cluster: parseInt(process.env.ARCIUM_CLUSTER || '456'),
    rpcUrl: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  },

  // Agent API
  agent: {
    port: parseInt(process.env.PORT || '3456'),
  },

  // Solana
  solana: {
    rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  },
};

export type Config = typeof config;
