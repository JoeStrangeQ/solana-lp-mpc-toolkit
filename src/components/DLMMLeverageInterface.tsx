/**
 * MnM DLMM Leverage Interface
 * Main UI for creating and managing leveraged DLMM positions
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";

// Import our DLMM leverage services
import leverageService, {
  buildLeverageTransaction,
  calculateLeverageAmounts,
  validateLeverageParams,
  estimatePostLeverageHealth,
  getUserLeveragedPositions,
  LeverageParams,
  PositionStatus,
} from "../services/leverageService";

import {
  DLMM_POOLS,
  getPoolInfo,
  getAvailablePools,
} from "../services/dlmmService";
import { RISK_PARAMS } from "../services/collateralService";

// ============ Types ============

interface PoolOption {
  name: string;
  address: PublicKey;
  pair: string;
}

// ============ Component ============

const DLMMLeverageInterface: React.FC = () => {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();

  // Pool selection
  const [availablePools, setAvailablePools] = useState<PoolOption[]>([]);
  const [selectedPool, setSelectedPool] = useState<PublicKey | null>(null);
  const [poolInfo, setPoolInfo] = useState<any>(null);

  // Position parameters
  const [baseAsset, setBaseAsset] = useState<"SOL" | "USDC">("USDC");
  const [amount, setAmount] = useState<string>("100");
  const [leverage, setLeverage] = useState<number>(2);
  const [binRange, setBinRange] = useState<number>(10);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionStatus[]>([]);

  // Calculated values
  const maxLeverage = useMemo(() => 1 / (1 - RISK_PARAMS.MAX_LTV), []);

  const leverageAmounts = useMemo(() => {
    const baseAmount = parseFloat(amount) || 0;
    if (baseAmount <= 0) return null;

    return calculateLeverageAmounts(baseAmount, leverage, {
      baseAssetPrice: baseAsset === "SOL" ? 100 : 1, // Would come from oracle
      quoteAssetPrice: 1,
    });
  }, [amount, leverage, baseAsset]);

  const estimatedHealth = useMemo(() => {
    if (!leverageAmounts) return 0;
    return estimatePostLeverageHealth(
      leverageAmounts.totalPositionSize,
      leverageAmounts.borrowRequired,
    );
  }, [leverageAmounts]);

  const validation = useMemo(() => {
    return validateLeverageParams(leverage, parseFloat(amount) || 0);
  }, [leverage, amount]);

  // ============ Effects ============

  // Load available pools
  useEffect(() => {
    const loadPools = async () => {
      const pools = await getAvailablePools();
      setAvailablePools(pools);
      if (pools.length > 0) {
        setSelectedPool(pools[0].address);
      }
    };
    loadPools();
  }, []);

  // Load pool info when selection changes
  useEffect(() => {
    const loadPoolInfo = async () => {
      if (!selectedPool || !connection) return;
      try {
        const info = await getPoolInfo(connection, selectedPool);
        setPoolInfo(info);
      } catch (e) {
        console.error("Failed to load pool info:", e);
      }
    };
    loadPoolInfo();
  }, [selectedPool, connection]);

  // Load user positions
  useEffect(() => {
    const loadPositions = async () => {
      if (!publicKey || !connection) return;
      try {
        const userPositions = await getUserLeveragedPositions(
          connection,
          publicKey,
          { SOL: 100, USDC: 1, USDT: 1 }, // Would come from oracle
        );
        setPositions(userPositions);
      } catch (e) {
        console.error("Failed to load positions:", e);
      }
    };
    loadPositions();
  }, [publicKey, connection]);

  // ============ Handlers ============

  const handleCreatePosition = useCallback(async () => {
    if (!publicKey || !selectedPool || !signTransaction || !validation.valid) {
      setError(validation.error || "Wallet not connected");
      return;
    }

    setIsLoading(true);
    setError(null);
    setTxSignature(null);

    try {
      // Create a temporary keypair for the user (in production, use wallet)
      // This is a workaround since we need a Keypair for signing
      const userKeypair = Keypair.generate(); // Placeholder

      const params: LeverageParams = {
        connection,
        user: userKeypair,
        baseAsset,
        baseAmount: parseFloat(amount),
        targetLeverage: leverage,
        poolAddress: selectedPool,
        binRange,
        slippageTolerance: 0.5,
      };

      const result = await buildLeverageTransaction(params);

      // Sign and send
      const signedTx = await signTransaction(result.transaction);
      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
      );

      await connection.confirmTransaction(signature, "confirmed");

      setTxSignature(signature);

      // Refresh positions
      const userPositions = await getUserLeveragedPositions(
        connection,
        publicKey,
        { SOL: 100, USDC: 1, USDT: 1 },
      );
      setPositions(userPositions);
    } catch (e) {
      console.error("Transaction failed:", e);
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setIsLoading(false);
    }
  }, [
    publicKey,
    selectedPool,
    signTransaction,
    validation,
    connection,
    baseAsset,
    amount,
    leverage,
    binRange,
  ]);

  // ============ Render ============

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">MnM Leverage</h1>
        <p className="text-gray-400">
          Open leveraged positions on Meteora DLMM
        </p>
      </div>

      {/* Pool Selector */}
      <div className="bg-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Select Pool</h2>
        <div className="grid grid-cols-3 gap-3">
          {availablePools.map((pool) => (
            <button
              key={pool.address.toBase58()}
              onClick={() => setSelectedPool(pool.address)}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedPool?.equals(pool.address)
                  ? "border-blue-500 bg-blue-500/20"
                  : "border-gray-600 bg-gray-700 hover:border-gray-500"
              }`}
            >
              <div className="text-white font-medium">{pool.name}</div>
              {poolInfo && selectedPool?.equals(pool.address) && (
                <div className="text-xs text-gray-400 mt-1">
                  Fee: {(poolInfo.feeRate * 100).toFixed(2)}%
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Position Builder */}
      <div className="bg-gray-800 rounded-xl p-6 space-y-6">
        <h2 className="text-lg font-semibold text-white">Build Position</h2>

        {/* Base Asset Selection */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Deposit Asset
          </label>
          <div className="flex gap-3">
            {(["SOL", "USDC"] as const).map((asset) => (
              <button
                key={asset}
                onClick={() => setBaseAsset(asset)}
                className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                  baseAsset === asset
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {asset}
              </button>
            ))}
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Amount</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
              min="0"
              step="0.01"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
              {baseAsset}
            </span>
          </div>
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex justify-between mb-2">
            <label className="text-sm text-gray-400">Leverage</label>
            <span className="text-white font-mono">{leverage.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="1.1"
            max={maxLeverage}
            step="0.1"
            value={leverage}
            onChange={(e) => setLeverage(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1.1x (Safe)</span>
            <span>{maxLeverage.toFixed(1)}x (Max)</span>
          </div>
        </div>

        {/* Bin Range */}
        <div>
          <div className="flex justify-between mb-2">
            <label className="text-sm text-gray-400">Price Range (bins)</label>
            <span className="text-white font-mono">±{binRange} bins</span>
          </div>
          <input
            type="range"
            min="5"
            max="50"
            step="5"
            value={binRange}
            onChange={(e) => setBinRange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Narrow (Higher APY)</span>
            <span>Wide (Safer)</span>
          </div>
        </div>

        {/* Position Summary */}
        {leverageAmounts && (
          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">Your Capital</span>
              <span className="text-white font-mono">
                ${parseFloat(amount).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Borrowed</span>
              <span className="text-yellow-400 font-mono">
                ${leverageAmounts.borrowRequired.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between border-t border-gray-700 pt-2">
              <span className="text-gray-400">Total Position</span>
              <span className="text-green-400 font-mono font-bold">
                ${leverageAmounts.totalPositionSize.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Est. Health Factor</span>
              <span
                className={`font-mono ${
                  estimatedHealth > 1.5
                    ? "text-green-400"
                    : estimatedHealth > 1.2
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {estimatedHealth.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Success Display */}
        {txSignature && (
          <div className="bg-green-500/20 border border-green-500 rounded-lg p-3 text-green-400 text-sm">
            Transaction successful!{" "}
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on Explorer
            </a>
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleCreatePosition}
          disabled={!publicKey || !validation.valid || isLoading}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            !publicKey || !validation.valid || isLoading
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600"
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Creating Position...
            </span>
          ) : !publicKey ? (
            "Connect Wallet"
          ) : !validation.valid ? (
            validation.error
          ) : (
            `Open ${leverage.toFixed(1)}x Leveraged Position`
          )}
        </button>
      </div>

      {/* Active Positions */}
      {positions.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Your Positions
          </h2>
          <div className="space-y-3">
            {positions.map((pos) => (
              <div
                key={pos.collateralPositionId}
                className="bg-gray-700 rounded-lg p-4 flex justify-between items-center"
              >
                <div>
                  <div className="text-white font-medium">{pos.poolPair}</div>
                  <div className="text-sm text-gray-400">
                    {pos.effectiveLeverage.toFixed(1)}x leverage
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-white font-mono">
                    ${pos.totalValueUSD.toFixed(2)}
                  </div>
                  <div
                    className={`text-sm ${
                      pos.status === "healthy"
                        ? "text-green-400"
                        : pos.status === "warning"
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    HF: {pos.healthFactor.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DLMMLeverageInterface;
