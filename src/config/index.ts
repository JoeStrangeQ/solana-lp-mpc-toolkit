/**
 * LP Agent Toolkit Configuration
 */

export const config = {
  // Hummingbot Gateway
  gateway: {
    url: process.env.GATEWAY_URL || 'http://localhost:15888',
    network: process.env.SOLANA_NETWORK || 'mainnet-beta',
  },

  // Portal MPC (legacy)
  portal: {
    apiUrl: process.env.PORTAL_API_URL || 'https://mpc-client.portalhq.io',
    apiKey: process.env.PORTAL_API_KEY || '',
    useMock: process.env.USE_MOCK_MPC === 'true',
  },

  // Privy Embedded Wallets (preferred)
  privy: {
    appId: process.env.PRIVY_APP_ID || '',
    appSecret: process.env.PRIVY_APP_SECRET || '',
    enabled: !!(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET),
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

  // Jupiter Swap
  jupiter: {
    apiKey: process.env.JUPITER_API_KEY || '',
    baseUrl: 'https://quote-api.jup.ag/v6',
  },
};

export type Config = typeof config;
