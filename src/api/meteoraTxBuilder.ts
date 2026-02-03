/**
 * Real Meteora DLMM Transaction Builder
 * Uses @meteora-ag/dlmm SDK in CommonJS mode
 */

import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import * as log from "./logger";

// Dynamic import for CJS compatibility
let DLMM: any = null;

async function getDLMM() {
  if (!DLMM) {
    DLMM = require("@meteora-ag/dlmm");
  }
  return DLMM;
}

export interface MeteoraAddLiquidityParams {
  poolAddress: string;
  userPubkey: string;
  amountX: number;
  amountY: number;
  slippageBps?: number;
}

export interface MeteoraPoolInfo {
  address: string;
  tokenX: { mint: string; symbol: string; decimals: number };
  tokenY: { mint: string; symbol: string; decimals: number };
  activeBinId: number;
  currentPrice: number;
  binStep: number;
}

export interface BuildTxResult {
  transaction: Transaction;
  serialized: string;
  message: string;
  estimatedFee: number;
}

/**
 * Get pool info from Meteora DLMM
 */
export async function getMeteoraPoolInfo(
  connection: Connection,
  poolAddress: string
): Promise<MeteoraPoolInfo> {
  const dlmmModule = await getDLMM();
  const pool = await dlmmModule.create(connection, new PublicKey(poolAddress));
  const activeBin = await pool.getActiveBin();
  
  return {
    address: poolAddress,
    tokenX: {
      mint: pool.tokenX.publicKey.toString(),
      symbol: pool.tokenX.mint?.symbol || "X",
      decimals: pool.tokenX.mint?.decimals || 6,
    },
    tokenY: {
      mint: pool.tokenY.publicKey.toString(),
      symbol: pool.tokenY.mint?.symbol || "Y", 
      decimals: pool.tokenY.mint?.decimals || 6,
    },
    activeBinId: activeBin.binId,
    currentPrice: parseFloat(activeBin.price),
    binStep: pool.lbPair.binStep,
  };
}

/**
 * Build REAL add liquidity transaction for Meteora DLMM
 */
export async function buildMeteoraAddLiquidityTx(
  connection: Connection,
  params: MeteoraAddLiquidityParams
): Promise<BuildTxResult> {
  const dlmmModule = await getDLMM();
  const { poolAddress, userPubkey, amountX, amountY, slippageBps = 100 } = params;
  
  log.info("Building Meteora TX", { poolAddress, userPubkey, amountX, amountY });
  
  // Validate inputs
  if (!poolAddress || typeof poolAddress !== 'string') {
    throw new Error(`Invalid poolAddress: ${poolAddress}`);
  }
  if (!userPubkey || typeof userPubkey !== 'string') {
    throw new Error(`Invalid userPubkey: ${userPubkey}`);
  }
  
  const poolPk = new PublicKey(poolAddress);
  const userPk = new PublicKey(userPubkey);
  
  log.info("PublicKeys created", { 
    pool: poolPk.toString(), 
    user: userPk.toString() 
  });
  
  const pool = await dlmmModule.create(connection, poolPk);
  log.info("DLMM pool loaded");
  
  const activeBin = await pool.getActiveBin();
  const activeBinId = activeBin.binId;
  log.info("Active bin", { activeBinId });
  
  const BINS_EACH_SIDE = 5;
  const minBinId = activeBinId - BINS_EACH_SIDE;
  const maxBinId = activeBinId + BINS_EACH_SIDE;
  
  // Get decimals safely
  const decimalsX = pool.tokenX.mint?.decimals || 6;
  const decimalsY = pool.tokenY.mint?.decimals || 6;
  
  const amountXLamports = new BN(Math.floor(amountX * Math.pow(10, decimalsX)));
  const amountYLamports = new BN(Math.floor(amountY * Math.pow(10, decimalsY)));
  
  log.info("Amounts", { 
    amountXLamports: amountXLamports.toString(), 
    amountYLamports: amountYLamports.toString(),
    decimalsX,
    decimalsY
  });

  const newPosition = Keypair.generate();
  
  log.info("Building TX with SDK...");
  const tx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: newPosition.publicKey,
    user: userPk,
    totalXAmount: amountXLamports,
    totalYAmount: amountYLamports,
    strategy: {
      strategyType: dlmmModule.StrategyType.SpotBalanced,
      minBinId,
      maxBinId,
    },
    slippage: slippageBps / 10000,
  });
  
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = userPk;
  tx.partialSign(newPosition);
  
  const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64");
  
  log.info("Meteora TX built successfully", { 
    activeBinId,
    binRange: `${minBinId}-${maxBinId}`,
    newPosition: newPosition.publicKey.toString(),
  });
  
  const tokenXAddr = pool.tokenX.publicKey.toString().slice(0,8);
  const tokenYAddr = pool.tokenY.publicKey.toString().slice(0,8);
  
  return {
    transaction: tx,
    serialized,
    message: `Add ${amountX} ${tokenXAddr}... + ${amountY} ${tokenYAddr}... to Meteora DLMM (bins ${minBinId}-${maxBinId})`,
    estimatedFee: 0.000005,
  };
}

export async function getMeteoraPositions(
  connection: Connection,
  poolAddress: string,
  userPubkey: string
): Promise<any[]> {
  const dlmmModule = await getDLMM();
  const pool = await dlmmModule.create(connection, new PublicKey(poolAddress));
  const user = new PublicKey(userPubkey);
  
  const positions = await pool.getPositionsByUserAndLbPair(user);
  
  return positions.map((pos: any) => ({
    pubkey: pos.publicKey.toString(),
    lowerBinId: pos.positionData?.lowerBinId,
    upperBinId: pos.positionData?.upperBinId,
  }));
}

export async function isMeteoraAvailable(): Promise<boolean> {
  try {
    await getDLMM();
    return true;
  } catch {
    return false;
  }
}
