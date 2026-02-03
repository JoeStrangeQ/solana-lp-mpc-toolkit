/**
 * Hummingbot Gateway Client
 * 
 * Unified interface for LP operations across Meteora, Orca, and Raydium
 */

import { config } from '../config';
import type {
  DEX,
  PoolInfo,
  Position,
  OpenPositionParams,
  OpenPositionResult,
  ClosePositionParams,
  AddLiquidityParams,
  RemoveLiquidityParams,
  CollectFeesParams,
  TransactionResult,
} from './types';

export class GatewayClient {
  private baseUrl: string;
  private network: string;
  private walletAddress: string;

  constructor(walletAddress: string) {
    this.baseUrl = config.gateway.url;
    this.network = config.gateway.network;
    this.walletAddress = walletAddress;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error((errorData as { error?: string }).error || `Gateway error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  // ============ Pool Discovery ============

  async fetchPools(dex: DEX, tokenA?: string, tokenB?: string): Promise<PoolInfo[]> {
    const params = new URLSearchParams({
      network: this.network,
      ...(tokenA && { tokenA }),
      ...(tokenB && { tokenB }),
    });

    return this.request<PoolInfo[]>('GET', `/connectors/${dex}/clmm/fetch-pools?${params}`);
  }

  async getPoolInfo(dex: DEX, poolAddress: string): Promise<PoolInfo> {
    return this.request<PoolInfo>('POST', `/connectors/${dex}/clmm/pool-info`, {
      network: this.network,
      address: poolAddress,
    });
  }

  // ============ Position Management ============

  async getPositions(dex: DEX): Promise<Position[]> {
    return this.request<Position[]>('POST', `/connectors/${dex}/clmm/positions-owned`, {
      network: this.network,
      address: this.walletAddress,
    });
  }

  async getAllPositions(): Promise<{ dex: DEX; positions: Position[] }[]> {
    const dexes: DEX[] = ['meteora', 'orca', 'raydium'];
    const results = await Promise.allSettled(
      dexes.map(async (dex) => ({
        dex,
        positions: await this.getPositions(dex),
      }))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<{ dex: DEX; positions: Position[] }> => 
        r.status === 'fulfilled'
      )
      .map((r) => r.value);
  }

  async getPositionInfo(dex: DEX, positionId: string): Promise<Position> {
    return this.request<Position>('POST', `/connectors/${dex}/clmm/position-info`, {
      network: this.network,
      address: this.walletAddress,
      positionId,
    });
  }

  // ============ LP Operations (Return Unsigned TX) ============

  async openPosition(params: OpenPositionParams): Promise<OpenPositionResult> {
    const { dex, pool, lowerPrice, upperPrice, tokenAAmount, tokenBAmount, slippage = 0.5 } = params;

    return this.request<OpenPositionResult>('POST', `/connectors/${dex}/clmm/open-position`, {
      network: this.network,
      address: this.walletAddress,
      pool,
      lowerPrice,
      upperPrice,
      tokenAAmount: tokenAAmount.toString(),
      tokenBAmount: tokenBAmount.toString(),
      slippage,
    });
  }

  async closePosition(params: ClosePositionParams): Promise<TransactionResult> {
    const { dex, positionId, slippage = 0.5 } = params;

    return this.request<TransactionResult>('POST', `/connectors/${dex}/clmm/close-position`, {
      network: this.network,
      address: this.walletAddress,
      positionId,
      slippage,
    });
  }

  async addLiquidity(params: AddLiquidityParams): Promise<TransactionResult> {
    const { dex, positionId, tokenAAmount, tokenBAmount, slippage = 0.5 } = params;

    return this.request<TransactionResult>('POST', `/connectors/${dex}/clmm/add-liquidity`, {
      network: this.network,
      address: this.walletAddress,
      positionId,
      tokenAAmount: tokenAAmount.toString(),
      tokenBAmount: tokenBAmount.toString(),
      slippage,
    });
  }

  async removeLiquidity(params: RemoveLiquidityParams): Promise<TransactionResult> {
    const { dex, positionId, percentage, slippage = 0.5 } = params;

    return this.request<TransactionResult>('POST', `/connectors/${dex}/clmm/remove-liquidity`, {
      network: this.network,
      address: this.walletAddress,
      positionId,
      percentage,
      slippage,
    });
  }

  async collectFees(params: CollectFeesParams): Promise<TransactionResult> {
    const { dex, positionId } = params;

    return this.request<TransactionResult>('POST', `/connectors/${dex}/clmm/collect-fees`, {
      network: this.network,
      address: this.walletAddress,
      positionId,
    });
  }

  // ============ Utilities ============

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/');
      return true;
    } catch {
      return false;
    }
  }
}
