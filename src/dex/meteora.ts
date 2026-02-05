/**
 * Direct Meteora DLMM Integration
 * 
 * Builds LP transactions using Meteora SDK directly,
 * bypassing Gateway for more reliable operation.
 */

import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';

export interface AddLiquidityParams {
  poolAddress: string;
  userPublicKey: string;
  amountX: number; // Amount in lamports/base units
  amountY: number;
  slippageBps?: number; // Default 300 = 3% (DLMM bins move fast)
  strategy?: 'concentrated' | 'wide' | 'custom'; // Default 'concentrated'
  minBinId?: number; // For custom strategy
  maxBinId?: number; // For custom strategy
  shape?: 'spot' | 'curve' | 'bidask'; // DLMM distribution shape (default: spot)
}

export interface AddLiquidityResult {
  transaction: string; // Base64 encoded
  positionAddress: string;
  positionKeypair: string; // Base64 encoded secret key for signing
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
    const { 
      poolAddress, 
      userPublicKey, 
      amountX, 
      amountY, 
      slippageBps = 300,
      strategy = 'concentrated',
      minBinId: customMinBin,
      maxBinId: customMaxBin,
      shape = 'spot',
    } = params;
    
    const pool = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const activeBin = await pool.getActiveBin();
    
    // Create position keypair
    const newPosition = Keypair.generate();
    
    // Calculate bin range based on strategy
    let minBinId: number;
    let maxBinId: number;
    
    if (strategy === 'custom' && customMinBin !== undefined && customMaxBin !== undefined) {
      // Custom: use provided bin IDs (relative to active bin)
      minBinId = activeBin.binId + customMinBin;
      maxBinId = activeBin.binId + customMaxBin;
    } else if (strategy === 'wide') {
      // Wide: ±20 bins for broader range
      minBinId = activeBin.binId - 20;
      maxBinId = activeBin.binId + 20;
    } else {
      // Concentrated (default): ±5 bins for tighter range, more capital efficiency
      minBinId = activeBin.binId - 5;
      maxBinId = activeBin.binId + 5;
    }
    
    // Map shape parameter to StrategyType
    let strategyType: StrategyType;
    switch (shape) {
      case 'curve':
        strategyType = StrategyType.Curve; // Bell curve distribution
        break;
      case 'bidask':
        strategyType = StrategyType.BidAsk; // Two-sided distribution
        break;
      case 'spot':
      default:
        strategyType = StrategyType.Spot; // Uniform/balanced distribution
        break;
    }

    // Build transaction to INITIALIZE position AND add liquidity (for new positions)
    // This is the correct method that includes the position keypair as a signer
    const initAndAddTx = await pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: new PublicKey(userPublicKey),
      totalXAmount: new BN(amountX),
      totalYAmount: new BN(amountY),
      strategy: {
        maxBinId,
        minBinId,
        strategyType, // Use the mapped strategy type
      },
      slippage: slippageBps / 10000, // Convert bps to decimal
    });
    
    // This returns a Transaction object directly
    const addLiquidityTx = initAndAddTx;

    // Get the transaction - SDK returns an object with tx property or the tx directly
    const tx = (addLiquidityTx as { tx?: Transaction }).tx || addLiquidityTx;
    
    // Serialize - handle both Transaction and VersionedTransaction
    let serialized: string;
    
    // Set recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    
    if ('recentBlockhash' in tx) {
      // Legacy Transaction - DON'T sign here, return unsigned
      // Position keypair signing will happen after Privy signs
      tx.recentBlockhash = blockhash;
      tx.feePayer = new PublicKey(userPublicKey);
      serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    } else if ('version' in tx) {
      // VersionedTransaction - DON'T sign here, return unsigned
      // Position keypair signing will happen after Privy signs
      const vTx = tx as unknown as VersionedTransaction;
      serialized = Buffer.from(vTx.serialize()).toString('base64');
    } else {
      // Unknown transaction type - try to serialize anyway
      serialized = Buffer.from((tx as { serialize(): Uint8Array }).serialize()).toString('base64');
    }

    return {
      transaction: serialized,
      positionAddress: newPosition.publicKey.toBase58(),
      positionKeypair: Buffer.from(newPosition.secretKey).toString('base64'), // Return keypair for later signing
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

  /**
   * Remove all liquidity and close position
   */
  async buildWithdrawTx(params: {
    poolAddress: string;
    positionAddress: string;
    userPublicKey: string;
  }): Promise<{ transaction: string }> {
    const { poolAddress, positionAddress, userPublicKey } = params;
    
    const pool = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const userPubkey = new PublicKey(userPublicKey);
    
    // Get position info
    const positions = await pool.getPositionsByUserAndLbPair(userPubkey);
    const position = positions.userPositions.find(
      p => p.publicKey.toBase58() === positionAddress
    );
    
    if (!position) {
      throw new Error(`Position ${positionAddress} not found`);
    }

    // Get bin range from position
    const lowerBinId = position.positionData.lowerBinId;
    const upperBinId = position.positionData.upperBinId;

    // Remove all liquidity from the position (100% = 10000 bps)
    const withdrawTx = await pool.removeLiquidity({
      position: position.publicKey,
      user: userPubkey,
      fromBinId: lowerBinId,
      toBinId: upperBinId,
      bps: new BN(10000), // 100%
      shouldClaimAndClose: true, // Claim fees and close position
    });

    // removeLiquidity returns Transaction[]
    const txArray = withdrawTx as Transaction[];
    if (!txArray.length) {
      throw new Error('No transactions returned from removeLiquidity');
    }

    // Serialize first transaction (usually there's just one)
    const tx = txArray[0];
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = userPubkey;
    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return { transaction: serialized };
  }

  /**
   * Get extended pool info including decimals and token metadata
   * Works for ANY pool address on Meteora DLMM
   */
  async getPoolInfoExtended(poolAddress: string): Promise<{
    address: string;
    activeBinId: number;
    currentPrice: number;
    binStep: number;
    tokenX: { mint: string; decimals: number; symbol?: string };
    tokenY: { mint: string; decimals: number; symbol?: string };
  }> {
    const pool = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const activeBin = await pool.getActiveBin();
    
    return {
      address: poolAddress,
      activeBinId: activeBin.binId,
      currentPrice: Number(pool.fromPricePerLamport(Number(activeBin.price))),
      binStep: Number(pool.lbPair.binStep),
      tokenX: {
        mint: pool.tokenX.publicKey.toBase58(),
        decimals: pool.tokenX.mint.decimals,
      },
      tokenY: {
        mint: pool.tokenY.publicKey.toBase58(),
        decimals: pool.tokenY.mint.decimals,
      },
    };
  }

  /**
   * Get ALL positions for a user across ALL Meteora DLMM pools
   * This is the universal portfolio view
   */
  async getAllUserPositions(userPublicKey: string): Promise<{
    poolAddress: string;
    positions: Array<{
      address: string;
      lowerBinId: number;
      upperBinId: number;
      liquidityShares: string;
    }>;
  }[]> {
    const userPubkey = new PublicKey(userPublicKey);
    const allPositions = await DLMM.getAllLbPairPositionsByUser(this.connection, userPubkey);
    
    const result: {
      poolAddress: string;
      positions: Array<{
        address: string;
        lowerBinId: number;
        upperBinId: number;
        liquidityShares: string;
      }>;
    }[] = [];
    
    for (const [poolAddress, positionInfo] of allPositions.entries()) {
      // lbPairPositionsData contains the positions for this pool
      const positions = (positionInfo.lbPairPositionsData || []).map((pos) => ({
        address: pos.publicKey.toBase58(),
        lowerBinId: pos.positionData.lowerBinId,
        upperBinId: pos.positionData.upperBinId,
        liquidityShares: pos.positionData.totalClaimedFeeXAmount?.toString() || '0',
      }));
      
      if (positions.length > 0) {
        result.push({ poolAddress, positions });
      }
    }
    
    return result;
  }

  /**
   * Search for DLMM pools by token pair
   */
  async searchPools(tokenA?: string, tokenB?: string): Promise<{
    address: string;
    name: string;
    mintX: string;
    mintY: string;
    liquidity: string;
    currentPrice: number;
    apy: number;
    volume24h: number;
    binStep: number;
  }[]> {
    try {
      const response = await fetch('https://dlmm-api.meteora.ag/pair/all_with_pagination?page=0&limit=100');
      if (!response.ok) return [];
      
      const data = await response.json() as { pairs: Array<{
        address: string;
        name: string;
        mint_x: string;
        mint_y: string;
        liquidity: string;
        current_price: number;
        apy: number;
        trade_volume_24h: number;
        bin_step: number;
      }> };
      
      let pools = data.pairs || [];
      
      // Filter by tokens if specified
      if (tokenA || tokenB) {
        const tokenSymbols = [tokenA?.toUpperCase(), tokenB?.toUpperCase()].filter(Boolean);
        pools = pools.filter(p => {
          const name = p.name.toUpperCase();
          return tokenSymbols.every(t => name.includes(t!));
        });
      }
      
      // Sort by liquidity descending
      pools.sort((a, b) => parseFloat(b.liquidity) - parseFloat(a.liquidity));
      
      return pools.slice(0, 10).map(p => ({
        address: p.address,
        name: p.name,
        mintX: p.mint_x,
        mintY: p.mint_y,
        liquidity: p.liquidity,
        currentPrice: p.current_price,
        apy: p.apy || 0,
        volume24h: p.trade_volume_24h || 0,
        binStep: p.bin_step,
      }));
    } catch (error) {
      console.error('[Meteora] Pool search failed:', error);
      return [];
    }
  }
}

export default MeteoraDirectClient;
