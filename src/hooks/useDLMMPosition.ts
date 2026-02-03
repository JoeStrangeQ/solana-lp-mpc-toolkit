/**
 * useDLMMPosition Hook
 * Manages DLMM position state and real-time updates
 */

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import {
  getUserLeveragedPositions,
  PositionStatus,
} from "../services/leverageService";

interface UseDLMMPositionOptions {
  refreshInterval?: number; // ms
  autoRefresh?: boolean;
}

interface UseDLMMPositionReturn {
  positions: PositionStatus[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getPosition: (id: string) => PositionStatus | undefined;
}

// Placeholder prices - in production, these would come from an oracle
const DEFAULT_PRICES = {
  SOL: 100,
  USDC: 1,
  USDT: 1,
};

export function useDLMMPosition(
  options: UseDLMMPositionOptions = {},
): UseDLMMPositionReturn {
  const { refreshInterval = 30000, autoRefresh = true } = options;

  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [positions, setPositions] = useState<PositionStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey || !connection) {
      setPositions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const userPositions = await getUserLeveragedPositions(
        connection,
        publicKey,
        DEFAULT_PRICES,
      );
      setPositions(userPositions);
    } catch (e) {
      console.error("Failed to fetch positions:", e);
      setError(e instanceof Error ? e.message : "Failed to fetch positions");
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  const getPosition = useCallback(
    (id: string) => positions.find((p) => p.collateralPositionId === id),
    [positions],
  );

  return {
    positions,
    isLoading,
    error,
    refresh,
    getPosition,
  };
}

export default useDLMMPosition;
