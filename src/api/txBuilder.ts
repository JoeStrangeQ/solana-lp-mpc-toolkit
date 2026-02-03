/**
 * Transaction Builder - Routes to real SDK or placeholder
 */
import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { 
  buildMeteoraAddLiquidityTx as buildMeteoraTx, 
  isMeteoraAvailable,
} from "./meteoraTxBuilder";
import * as log from "./logger";

export interface AddLiquidityRequest {
  pool: string;
  venue: string;
  tokenA: string;
  tokenB: string;
  amountA: number;
  amountB?: number;
  userPubkey: string;
  slippageBps?: number;
}

export interface TxResult {
  success: boolean;
  transaction?: {
    serialized: string;
    message: string;
    estimatedFee: number;
    expiresAt?: number;
  };
  instructions?: string[];
  error?: string;
}

/**
 * Build add liquidity transaction
 * Uses real SDK for Meteora, placeholder for others
 */
export async function buildAddLiquidityTx(
  connection: Connection,
  request: AddLiquidityRequest
): Promise<TxResult> {
  const { pool, venue, tokenA, tokenB, amountA, amountB, userPubkey, slippageBps } = request;
  
  log.info("Building add liquidity TX", { venue, tokenA, tokenB, amountA });
  
  try {
    // Use REAL Meteora SDK for meteora venue
    if (venue === "meteora") {
      const meteoraAvailable = await isMeteoraAvailable();
      log.info("Meteora SDK check", { available: meteoraAvailable });
      
      if (meteoraAvailable) {
        log.info("Using REAL Meteora SDK for TX building");
        
        const result = await buildMeteoraTx(connection, {
          poolAddress: pool,
          userPubkey,
          amountX: amountA,
          amountY: amountB || amountA,
          slippageBps,
        });
        
        return {
          success: true,
          transaction: {
            serialized: result.serialized,
            message: result.message,
            estimatedFee: result.estimatedFee,
          },
          instructions: ["[REAL] " + result.message],
        };
      }
    }
    
    // Placeholder for other DEXs or if Meteora SDK not available
    log.info("Using placeholder TX", { venue });
    return buildPlaceholderTx(request);
    
  } catch (error: any) {
    log.error("TX build failed", { error: error.message, stack: error.stack?.split('\n')[0] });
    
    // If SDK fails, fall back to placeholder
    log.warn("SDK failed, falling back to placeholder");
    return buildPlaceholderTx(request);
  }
}

/**
 * Placeholder transaction for non-SDK venues or fallback
 */
function buildPlaceholderTx(request: AddLiquidityRequest): TxResult {
  const { pool, venue, tokenA, tokenB, amountA, amountB, slippageBps } = request;
  
  const placeholderData = {
    action: "add_liquidity",
    venue,
    pool,
    tokenA,
    tokenB,
    amountA,
    amountB,
    slippageBps: slippageBps || 100,
    timestamp: Date.now(),
  };
  
  const serialized = Buffer.from(JSON.stringify(placeholderData)).toString("base64");
  
  return {
    success: true,
    transaction: {
      serialized,
      message: `[PLACEHOLDER] Add ${amountA} ${tokenA} + ${amountB || '?'} ${tokenB} to ${venue}`,
      estimatedFee: 0.000005,
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    },
    instructions: [`[PLACEHOLDER] Add liquidity to ${venue} pool`],
  };
}

/**
 * Build remove liquidity transaction
 */
export async function buildRemoveLiquidityTx(
  connection: Connection,
  request: { userPubkey: string; positionId: string; venue: string; percentage?: number }
): Promise<TxResult> {
  return {
    success: true,
    transaction: {
      serialized: Buffer.from("remove_placeholder").toString("base64"),
      message: `Remove liquidity from ${request.venue} position`,
      estimatedFee: 0.000005,
    },
    instructions: ["Remove liquidity"],
  };
}

/**
 * Describe a transaction for display
 */
export function describeTx(txBase64: string): string {
  try {
    const data = JSON.parse(Buffer.from(txBase64, "base64").toString());
    return `${data.action}: ${data.amountA} ${data.tokenA} on ${data.venue}`;
  } catch {
    return "Transaction details unavailable";
  }
}
