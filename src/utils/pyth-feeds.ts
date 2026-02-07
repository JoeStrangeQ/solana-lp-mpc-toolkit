/**
 * Pyth Price Feed IDs for common Solana tokens
 *
 * Maps token mint addresses to Pyth Hermes price feed IDs.
 * Feed IDs from: https://pyth.network/developers/price-feed-ids
 */

// Mint address -> Pyth price feed ID
export const PYTH_FEED_IDS: Record<string, string> = {
  // SOL
  'So11111111111111111111111111111111111111112':
    '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  // USDC
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v':
    '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  // USDT
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB':
    '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  // ETH (Wormhole)
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs':
    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  // BTC (Wormhole)
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh':
    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  // JitoSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn':
    '0x67be9f519b95cf24338801051f9a808eff0a578ccb388db73b7f6fe1de019ffb',
  // mSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So':
    '0xc2289a6a43d2ce91c6f55caec370f4acc38a2ed477f58813334c6d03749ff2a4',
  // BONK
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263':
    '0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  // JUP
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN':
    '0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  // RAY
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R':
    '0x91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a',
  // WIF
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm':
    '0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6571f4b8b4f26e72f',
};

/**
 * Get Pyth feed ID for a token mint address, or undefined if not mapped.
 */
export function getPythFeedId(mint: string): string | undefined {
  return PYTH_FEED_IDS[mint];
}
