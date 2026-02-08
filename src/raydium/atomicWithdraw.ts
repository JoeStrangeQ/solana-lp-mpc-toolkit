/**
 * Raydium CLMM Withdraw Pipeline
 *
 * Builds decrease liquidity + collect fees/rewards + close position transactions.
 * Uses the Raydium SDK v2 for transaction building.
 */

import { PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js';
import {
  Raydium,
  TxVersion,
  type ApiV3PoolInfoConcentratedItem,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import { arciumPrivacy } from '../privacy/index.js';

export interface RaydiumWithdrawParams {
  walletAddress: string;
  poolAddress: string;
  positionNftMint: string;
  slippageBps?: number;
  closePosition?: boolean;
}

export interface BuiltRaydiumWithdraw {
  unsignedTransactions: string[];
  estimatedWithdraw: { tokenA: string; tokenB: string };
  fees: { tokenA: string; tokenB: string };
}

export async function buildRaydiumWithdraw(
  connection: Connection,
  params: RaydiumWithdrawParams,
): Promise<BuiltRaydiumWithdraw> {
  const {
    walletAddress,
    poolAddress,
    positionNftMint,
    slippageBps = 300,
    closePosition = true,
  } = params;

  // Encrypt strategy with Arcium before execution
  const encrypted = await arciumPrivacy.encryptStrategy({
    intent: 'raydium_withdraw',
    pool: poolAddress,
    position: positionNftMint,
  });
  console.log(`[Raydium Withdraw] Strategy encrypted: ${encrypted.ciphertext.slice(0, 20)}...`);

  // Initialize Raydium SDK
  const owner = new PublicKey(walletAddress);
  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
  });

  // Fetch pool info
  const poolInfoList = await raydium.api.fetchPoolById({ ids: poolAddress });
  if (!poolInfoList.length) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }
  const poolInfo = poolInfoList[0] as ApiV3PoolInfoConcentratedItem;

  // Get pool keys
  const poolKeys = await raydium.clmm.getClmmPoolKeys(poolAddress);

  // Get owner's positions
  const positionLayouts = await raydium.clmm.getOwnerPositionInfo({});
  const positionLayout = positionLayouts.find(p => p.nftMint.toBase58() === positionNftMint);
  if (!positionLayout) {
    throw new Error(`Position not found: ${positionNftMint}`);
  }

  const unsignedTransactions: string[] = [];

  // Build decrease liquidity transaction (100% to withdraw all)
  const { execute } = await raydium.clmm.decreaseLiquidity({
    poolInfo,
    poolKeys,
    ownerPosition: positionLayout as unknown as Parameters<typeof raydium.clmm.decreaseLiquidity>[0]['ownerPosition'],
    ownerInfo: {
      useSOLBalance: true,
      closePosition,
    },
    liquidity: positionLayout.liquidity,
    amountMinA: new BN(0), // Use slippage tolerance
    amountMinB: new BN(0),
    txVersion: TxVersion.V0,
  });

  const result = await execute({ sendAndConfirm: false });

  if (result.signedTx instanceof VersionedTransaction) {
    unsignedTransactions.push(Buffer.from(result.signedTx.serialize()).toString('base64'));
  }

  // Note: Raydium SDK position layouts don't have amountA/amountB directly
  // We'd need to calculate from liquidity and tick range, or fetch from RPC
  // For now, return placeholder values - actual amounts come from the transaction
  const estimatedWithdraw = {
    tokenA: '0', // Would need calculation from liquidity
    tokenB: '0',
  };

  const fees = {
    tokenA: positionLayout.tokenFeesOwedA?.toString() || '0',
    tokenB: positionLayout.tokenFeesOwedB?.toString() || '0',
  };

  return {
    unsignedTransactions,
    estimatedWithdraw,
    fees,
  };
}

/**
 * Build transaction to harvest fees only (without closing position)
 */
export async function buildRaydiumHarvestRewards(
  connection: Connection,
  params: {
    walletAddress: string;
    poolAddress: string;
    positionNftMint: string;
  },
): Promise<{ unsignedTransactions: string[]; fees: { tokenA: string; tokenB: string } }> {
  const { walletAddress, poolAddress, positionNftMint } = params;

  const owner = new PublicKey(walletAddress);
  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
  });

  // Fetch pool info
  const poolInfoList = await raydium.api.fetchPoolById({ ids: poolAddress });
  if (!poolInfoList.length) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }
  const poolInfo = poolInfoList[0] as ApiV3PoolInfoConcentratedItem;

  // Get pool keys
  const poolKeys = await raydium.clmm.getClmmPoolKeys(poolAddress);

  // Get owner's positions
  const positionLayouts = await raydium.clmm.getOwnerPositionInfo({});
  const positionLayout = positionLayouts.find(p => p.nftMint.toBase58() === positionNftMint);
  if (!positionLayout) {
    throw new Error(`Position not found: ${positionNftMint}`);
  }

  // Decrease 0 liquidity to just collect fees
  const { execute } = await raydium.clmm.decreaseLiquidity({
    poolInfo,
    poolKeys,
    ownerPosition: positionLayout as unknown as Parameters<typeof raydium.clmm.decreaseLiquidity>[0]['ownerPosition'],
    ownerInfo: {
      useSOLBalance: true,
      closePosition: false,
    },
    liquidity: new BN(0), // 0 liquidity = just collect fees
    amountMinA: new BN(0),
    amountMinB: new BN(0),
    txVersion: TxVersion.V0,
  });

  const unsignedTransactions: string[] = [];
  const result = await execute({ sendAndConfirm: false });

  if (result.signedTx instanceof VersionedTransaction) {
    unsignedTransactions.push(Buffer.from(result.signedTx.serialize()).toString('base64'));
  }

  return {
    unsignedTransactions,
    fees: {
      tokenA: positionLayout.tokenFeesOwedA?.toString() || '0',
      tokenB: positionLayout.tokenFeesOwedB?.toString() || '0',
    },
  };
}

/**
 * Partial withdraw - decrease specific percentage of liquidity
 */
export async function buildRaydiumPartialWithdraw(
  connection: Connection,
  params: {
    walletAddress: string;
    poolAddress: string;
    positionNftMint: string;
    liquidityPercent: number; // 0-100
    slippageBps?: number;
  },
): Promise<BuiltRaydiumWithdraw> {
  const { walletAddress, poolAddress, positionNftMint, liquidityPercent, slippageBps = 300 } = params;

  if (liquidityPercent < 0 || liquidityPercent > 100) {
    throw new Error('liquidityPercent must be between 0 and 100');
  }

  const owner = new PublicKey(walletAddress);
  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
  });

  // Fetch pool info
  const poolInfoList = await raydium.api.fetchPoolById({ ids: poolAddress });
  if (!poolInfoList.length) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }
  const poolInfo = poolInfoList[0] as ApiV3PoolInfoConcentratedItem;

  // Get pool keys
  const poolKeys = await raydium.clmm.getClmmPoolKeys(poolAddress);

  // Get owner's positions
  const positionLayouts = await raydium.clmm.getOwnerPositionInfo({});
  const positionLayout = positionLayouts.find(p => p.nftMint.toBase58() === positionNftMint);
  if (!positionLayout) {
    throw new Error(`Position not found: ${positionNftMint}`);
  }

  // Calculate liquidity to withdraw
  const liquidityToWithdraw = positionLayout.liquidity.muln(liquidityPercent).divn(100);
  const closePosition = liquidityPercent === 100;

  const { execute } = await raydium.clmm.decreaseLiquidity({
    poolInfo,
    poolKeys,
    ownerPosition: positionLayout as unknown as Parameters<typeof raydium.clmm.decreaseLiquidity>[0]['ownerPosition'],
    ownerInfo: {
      useSOLBalance: true,
      closePosition,
    },
    liquidity: liquidityToWithdraw,
    amountMinA: new BN(0),
    amountMinB: new BN(0),
    txVersion: TxVersion.V0,
  });

  const unsignedTransactions: string[] = [];
  const result = await execute({ sendAndConfirm: false });

  if (result.signedTx instanceof VersionedTransaction) {
    unsignedTransactions.push(Buffer.from(result.signedTx.serialize()).toString('base64'));
  }

  return {
    unsignedTransactions,
    estimatedWithdraw: {
      tokenA: '0', // Would need to calculate from liquidity
      tokenB: '0',
    },
    fees: {
      tokenA: positionLayout.tokenFeesOwedA?.toString() || '0',
      tokenB: positionLayout.tokenFeesOwedB?.toString() || '0',
    },
  };
}
