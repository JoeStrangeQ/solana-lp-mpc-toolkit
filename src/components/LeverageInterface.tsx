import React, { useState, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { buildAtomicLeverageTransaction } from "../services/lendingService";
import { usePoolState } from "../hooks/usePoolState";

const LeverageInterface = () => {
  const { publicKey, sendTransaction } = useWallet();
  const { poolState } = usePoolState();
  const [leverage, setLeverage] = useState(2);
  const [collateralAmount, setCollateralAmount] = useState(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const connection = useMemo(
    () => new Connection(process.env.REACT_APP_RPC_URL!, "confirmed"),
    [],
  );

  const maxLeverage = useMemo(() => {
    if (!poolState) return 1;
    // Max LTV is 80%, so max leverage is 1 / (1 - 0.8) = 5x
    return 1 / (1 - poolState.maxLtv / 100);
  }, [poolState]);

  const handleLeverageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (value > 0 && value <= maxLeverage) {
      setLeverage(value);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (value > 0) {
      setCollateralAmount(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !poolState) {
      setError("Wallet not connected or pool state not loaded.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSignature(null);

    try {
      const transaction = await buildAtomicLeverageTransaction({
        connection,
        user: publicKey,
        collateralAmount,
        leverage,
        pool: new PublicKey(poolState.poolAddress), // Assuming we have pool address
      });

      const txid = await sendTransaction(transaction, connection);
      console.log("Transaction sent:", txid);
      setSignature(txid);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 text-white">Leverage Loop</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label
            htmlFor="collateral-amount"
            className="block text-sm font-medium text-gray-300"
          >
            Collateral Amount (USDC)
          </label>
          <input
            id="collateral-amount"
            type="number"
            value={collateralAmount}
            onChange={handleAmountChange}
            className="mt-1 block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm text-white focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            min="1"
            step="1"
          />
        </div>

        <div className="mb-4">
          <label
            htmlFor="leverage-slider"
            className="block text-sm font-medium text-gray-300"
          >
            Leverage: {leverage.toFixed(1)}x
          </label>
          <input
            id="leverage-slider"
            type="range"
            min="1.1"
            max={maxLeverage}
            step="0.1"
            value={leverage}
            onChange={handleLeverageChange}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>1.1x</span>
            <span>{maxLeverage.toFixed(1)}x</span>
          </div>
        </div>

        <div className="bg-gray-700 p-4 rounded-md mb-4 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Total Position Size:</span>
            <span className="text-white font-mono">
              ${(collateralAmount * leverage).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-400">Amount Borrowed:</span>
            <span className="text-white font-mono">
              ${(collateralAmount * (leverage - 1)).toFixed(2)}
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !publicKey}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-500 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Submitting..." : "Execute Loop"}
        </button>

        {error && <p className="text-red-500 mt-4">{error}</p>}
        {signature && (
          <p className="text-green-500 mt-4">
            Success!{" "}
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View Transaction
            </a>
          </p>
        )}
      </form>
    </div>
  );
};

export default LeverageInterface;
