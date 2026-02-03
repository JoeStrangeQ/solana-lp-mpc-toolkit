import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { formatUnits } from "../utils/format";

// MnM Lending Protocol Program ID
const LENDING_PROGRAM_ID = new PublicKey(
  "EswKHJ3PtYsCpywWvX4wosJXjJbswYjqwE9E6wLGVCFS",
);

interface PoolStats {
  totalDeposits: number;
  totalBorrows: number;
  utilizationRate: number;
  interestRate: number;
  availableLiquidity: number;
}

interface UserPosition {
  deposited: number;
  borrowed: number;
  collateralValue: number;
  healthFactor: number;
}

export function LendingPool() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [poolStats, setPoolStats] = useState<PoolStats>({
    totalDeposits: 0,
    totalBorrows: 0,
    utilizationRate: 0,
    interestRate: 5,
    availableLiquidity: 0,
  });

  const [userPosition, setUserPosition] = useState<UserPosition>({
    deposited: 0,
    borrowed: 0,
    collateralValue: 0,
    healthFactor: 0,
  });

  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Fetch pool stats (placeholder - will integrate with actual program)
  useEffect(() => {
    const fetchPoolStats = async () => {
      // TODO: Fetch from on-chain pool account
      setPoolStats({
        totalDeposits: 1000000,
        totalBorrows: 650000,
        utilizationRate: 65,
        interestRate: 5,
        availableLiquidity: 350000,
      });
    };

    fetchPoolStats();
  }, [connection]);

  // Fetch user position
  useEffect(() => {
    if (!publicKey) return;

    const fetchUserPosition = async () => {
      // TODO: Fetch from on-chain user position account
      setUserPosition({
        deposited: 0,
        borrowed: 0,
        collateralValue: 0,
        healthFactor: 0,
      });
    };

    fetchUserPosition();
  }, [publicKey, connection]);

  const handleDeposit = async () => {
    if (!publicKey || !depositAmount) return;
    setIsLoading(true);

    try {
      // TODO: Build and send deposit transaction
      console.log("Depositing", depositAmount, "USDC");
      setDepositAmount("");
    } catch (error) {
      console.error("Deposit failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBorrow = async () => {
    if (!publicKey || !borrowAmount) return;
    setIsLoading(true);

    try {
      // TODO: Build and send borrow transaction
      console.log("Borrowing", borrowAmount, "USDC");
      setBorrowAmount("");
    } catch (error) {
      console.error("Borrow failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lending-pool">
      {/* Pool Stats */}
      <div className="pool-stats">
        <h2>🏦 MnM Lending Pool</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Total Deposits</span>
            <span className="stat-value">
              ${formatUnits(poolStats.totalDeposits, 6)}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Borrows</span>
            <span className="stat-value">
              ${formatUnits(poolStats.totalBorrows, 6)}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Utilization</span>
            <span className="stat-value">{poolStats.utilizationRate}%</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">APY</span>
            <span className="stat-value">{poolStats.interestRate}%</span>
          </div>
        </div>
      </div>

      {/* User Actions */}
      {connected ? (
        <div className="user-actions">
          <div className="action-card">
            <h3>💰 Deposit USDC</h3>
            <p className="balance">
              Your deposit: ${formatUnits(userPosition.deposited, 6)}
            </p>
            <div className="input-group">
              <input
                type="number"
                placeholder="Amount"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                disabled={isLoading}
              />
              <button
                onClick={handleDeposit}
                disabled={isLoading || !depositAmount}
              >
                {isLoading ? "Processing..." : "Deposit"}
              </button>
            </div>
          </div>

          <div className="action-card">
            <h3>📈 Borrow USDC</h3>
            <p className="balance">
              Your debt: ${formatUnits(userPosition.borrowed, 6)}
            </p>
            <p className="health">
              Health Factor: {userPosition.healthFactor.toFixed(2)}
            </p>
            <div className="input-group">
              <input
                type="number"
                placeholder="Amount"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                disabled={isLoading}
              />
              <button
                onClick={handleBorrow}
                disabled={isLoading || !borrowAmount}
              >
                {isLoading ? "Processing..." : "Borrow"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="connect-prompt">
          <p>Connect your wallet to use the lending pool</p>
        </div>
      )}

      {/* Available Liquidity */}
      <div className="liquidity-bar">
        <span>Available: ${formatUnits(poolStats.availableLiquidity, 6)}</span>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${poolStats.utilizationRate}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default LendingPool;
