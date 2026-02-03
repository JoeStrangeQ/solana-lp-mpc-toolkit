/**
 * Direct Meteora DLMM Integration
 * 
 * Builds LP transactions using Meteora SDK directly,
 * bypassing Gateway for more reliable operation.
 */

import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';

export interface AddLiquidityParams {
  poolAddress: string;
  userPublicKey: string;
  amountX: number; // Amount in lamports/base units
  amountY: number;
  slippageBps?: number; // Default 100 = 1%
}

export interface AddLiquidityResult {
  transaction: string; // Base64 encoded
  positionAddress: string;
  binRange: { min: number; max: number };
  estimatedFee: number;
}

export class MeteoraDirectClient {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl);
  }

  /**
   * Get pool info
   */
  async getPoolInfo(poolAddress: string): Promise<{
    address: string;
    activeBinId: number;
    currentPrice: number;
    binStep: number;
    tokenX: string;
    tokenY: string;
  }> {
    const pool = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const activeBin = await pool.getActiveBin();
    
    return {
      address: poolAddress,
      activeBinId: activeBin.binId,
      currentPrice: Number(pool.fromPricePerLamport(Number(activeBin.price))),
      binStep: Number(pool.lbPair.binStep),
      tokenX: pool.tokenX.publicKey.toBase58(),
      tokenY: pool.tokenY.publicKey.toBase58(),
    };
  }

  /**
   * Build add liquidity transaction
   */
  async buildAddLiquidityTx(params: AddLiquidityParams): Promise<AddLiquidityResult> {
    const { poolAddress, userPublicKey, amountX, amountY, slippageBps = 100 } = params;
    
    const pool = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const activeBin = await pool.getActiveBin();
    
    // Create position keypair
    const newPosition = Keypair.generate();
    
    // Calculate bin range (10 bins each side = balanced strategy)
    const RANGE_INTERVAL = 10;
    const minBinId = activeBin.binId - RANGE_INTERVAL;
    const maxBinId = activeBin.binId + RANGE_INTERVAL;
    
    // Build the add liquidity transaction using spot strategy
    const addLiquidityTx = await pool.addLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: new PublicKey(userPublicKey),
      totalXAmount: new BN(amountX),
      totalYAmount: new BN(amountY),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot, // Spot = balanced distribution
      },
      slippage: slippageBps / 10000, // Convert bps to decimal
    });

    // Get the transaction - SDK returns an object with tx property or the tx directly
    const tx = (addLiquidityTx as { tx?: Transaction }).tx || addLiquidityTx;
    
    // Serialize - handle both Transaction and VersionedTransaction
    let serialized: string;
    
    // Set recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    
    if ('recentBlockhash' in tx) {
      // Legacy Transaction
      tx.recentBlockhash = blockhash;
      tx.feePayer = new PublicKey(userPublicKey);
      tx.partialSign(newPosition);
      serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
    } else {
      // VersionedTransaction - serialize as-is
      serialized = Buffer.from((tx as { serialize(): Uint8Array }).serialize()).toString('base64');
    }

    return {
      transaction: serialized,
      positionAddress: newPosition.publicKey.toBase58(),
      binRange: { min: minBinId, max: maxBinId },
      estimatedFee: 5000, // ~0.000005 SOL
    };
  }

  /**
   * Get user positions in a pool
   */
  async getUserPositions(poolAddress: string, userPublicKey: string) {
    const pool = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const positions = await pool.getPositionsByUserAndLbPair(new PublicKey(userPublicKey));
    
    return positions.userPositions.map(pos => ({
      address: pos.publicKey.toBase58(),
      lowerBinId: pos.positionData.lowerBinId,
      upperBinId: pos.positionData.upperBinId,
      liquidityShares: pos.positionData.totalClaimedFeeXAmount?.toString() || '0',
    }));
  }
}

export default MeteoraDirectClient;
