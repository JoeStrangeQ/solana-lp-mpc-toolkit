/**
 * Raydium CLMM type definitions
 */

export interface RaydiumPoolInfo {
  address: string;
  name: string;
  tokenA: { mint: string; symbol: string; decimals: number };
  tokenB: { mint: string; symbol: string; decimals: number };
  tickSpacing: number;
  feeRate: number; // decimal (e.g., 0.0005 = 0.05%)
  tvl: number;
  volume24h: number;
  price: number;
  apr24h: number;
  config: {
    id: string;
    index: number;
    protocolFeeRate: number;
    tradeFeeRate: number;
    tickSpacing: number;
    fundFeeRate: number;
  };
}

export interface RaydiumPositionInfo {
  address: string;        // Position NFT account address
  nftMint: string;        // Position NFT mint
  poolAddress: string;
  poolName: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: string;
  tokenA: { amount: string; symbol: string };
  tokenB: { amount: string; symbol: string };
  fees: { tokenA: string; tokenB: string };
  rewards: Array<{ mint: string; amount: string }>;
  inRange: boolean;
  priceLower: number;
  priceUpper: number;
  priceCurrent: number;
  dex: 'raydium';
}

export interface RaydiumApiPool {
  type: string;
  programId: string;
  id: string;
  mintA: {
    chainId: number;
    address: string;
    programId: string;
    logoURI: string;
    symbol: string;
    name: string;
    decimals: number;
    tags: string[];
    extensions: Record<string, unknown>;
  };
  mintB: {
    chainId: number;
    address: string;
    programId: string;
    logoURI: string;
    symbol: string;
    name: string;
    decimals: number;
    tags: string[];
    extensions: Record<string, unknown>;
  };
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  openTime: string;
  tvl: number;
  day: {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: number[];
  };
  week: {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: number[];
  };
  month: {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: number[];
  };
  pooltype: string[];
  farmUpcomingCount: number;
  farmOngoingCount: number;
  farmFinishedCount: number;
  config: {
    id: string;
    index: number;
    protocolFeeRate: number;
    tradeFeeRate: number;
    tickSpacing: number;
    fundFeeRate: number;
    defaultRange: number;
    defaultRangePoint: number[];
  };
  burnPercent: number;
  launchMigratePool: boolean;
  rewardDefaultInfos?: Array<{
    mint: {
      address: string;
      symbol: string;
      decimals: number;
    };
    perSecond: string;
    startTime: string;
    endTime: string;
  }>;
}

export interface RaydiumApiResponse {
  id: string;
  success: boolean;
  data: {
    count: number;
    data: RaydiumApiPool[];
    hasNextPage: boolean;
  };
}
