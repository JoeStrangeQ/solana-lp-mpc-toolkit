/**
 * MnM DLMM Leverage Flow Tests
 *
 * Tests for the atomic leverage transaction flow.
 * Run with: npx ts-node tests/leverage-flow.test.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import BN from "bn.js";

// Import services
import {
  buildLeverageTransaction,
  calculateLeverageAmounts,
  validateLeverageParams,
  estimatePostLeverageHealth,
} from "../src/services/leverageService";

import { DLMM_POOLS, getPoolInfo } from "../src/services/dlmmService";

import {
  calculateHealthFactor,
  calculateLTV,
  calculatePositionRisk,
  validateBorrow,
  RISK_PARAMS,
} from "../src/utils/riskCalculations";

// ============ Test Configuration ============

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Test wallet (generate fresh for tests)
const testWallet = Keypair.generate();

// ============ Unit Tests ============

describe("Leverage Calculations", () => {
  test("calculateLeverageAmounts returns correct values for 2x leverage", () => {
    const result = calculateLeverageAmounts(100, 2, {
      baseAssetPrice: 100,
      quoteAssetPrice: 1,
    });

    expect(result.totalPositionSize).toBe(200);
    expect(result.borrowRequired).toBe(100);
  });

  test("calculateLeverageAmounts returns correct values for 5x leverage", () => {
    const result = calculateLeverageAmounts(100, 5, {
      baseAssetPrice: 100,
      quoteAssetPrice: 1,
    });

    expect(result.totalPositionSize).toBe(500);
    expect(result.borrowRequired).toBe(400);
  });

  test("validateLeverageParams rejects leverage below 1.1x", () => {
    const result = validateLeverageParams(1.0, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Minimum leverage");
  });

  test("validateLeverageParams rejects leverage above 5x", () => {
    const result = validateLeverageParams(6, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Maximum leverage");
  });

  test("validateLeverageParams accepts valid params", () => {
    const result = validateLeverageParams(3, 100);
    expect(result.valid).toBe(true);
  });
});

describe("Risk Calculations", () => {
  test("calculateHealthFactor returns correct value", () => {
    // Collateral: $1000, Debt: $500, Liquidation Threshold: 85%
    // HF = (1000 * 0.85) / 500 = 1.7
    const hf = calculateHealthFactor(1000, 500);
    expect(hf).toBeCloseTo(1.7, 2);
  });

  test("calculateHealthFactor returns Infinity for zero debt", () => {
    const hf = calculateHealthFactor(1000, 0);
    expect(hf).toBe(Infinity);
  });

  test("calculateLTV returns correct value", () => {
    // Collateral: $1000, Debt: $800
    // LTV = 800 / 1000 = 0.8 (80%)
    const ltv = calculateLTV(1000, 800);
    expect(ltv).toBeCloseTo(0.8, 2);
  });

  test("validateBorrow rejects exceeding max LTV", () => {
    // Collateral: $100, try to borrow $90 (90% LTV)
    const result = validateBorrow(100, 0, 90);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("LTV");
  });

  test("validateBorrow accepts safe borrow", () => {
    // Collateral: $100, borrow $50 (50% LTV)
    const result = validateBorrow(100, 0, 50);
    expect(result.valid).toBe(true);
  });

  test("calculatePositionRisk returns correct status", () => {
    // Healthy position: $1000 collateral, $400 debt
    const risk = calculatePositionRisk(1000, 400, 100);
    expect(risk.status).toBe("healthy");
    expect(risk.healthFactor).toBeGreaterThan(1.5);
  });

  test("calculatePositionRisk detects danger", () => {
    // Dangerous position: $1000 collateral, $800 debt
    const risk = calculatePositionRisk(1000, 800, 100);
    expect(risk.status).toBe("danger");
    expect(risk.healthFactor).toBeLessThan(1.2);
  });
});

describe("Leverage Validation", () => {
  test("estimatePostLeverageHealth calculates correctly", () => {
    // $100 capital, 3x leverage = $300 position, $200 borrowed
    const health = estimatePostLeverageHealth(300, 200);
    // HF = (300 * 0.85) / 200 = 1.275
    expect(health).toBeCloseTo(1.275, 2);
  });

  test("max leverage results in minimum health factor", () => {
    // At 5x leverage: $100 capital = $500 position, $400 borrowed
    const health = estimatePostLeverageHealth(500, 400);
    // HF = (500 * 0.85) / 400 = 1.0625
    expect(health).toBeGreaterThan(1);
    expect(health).toBeLessThan(1.1);
  });
});

// ============ Integration Tests (Requires Devnet) ============

describe("Integration: Pool Info", () => {
  test.skip("can fetch SOL/USDC pool info", async () => {
    const poolInfo = await getPoolInfo(connection, DLMM_POOLS.SOL_USDC);

    expect(poolInfo.address.equals(DLMM_POOLS.SOL_USDC)).toBe(true);
    expect(poolInfo.tokenX.symbol).toBe("SOL");
    expect(poolInfo.tokenY.symbol).toBe("USDC");
    expect(poolInfo.activeBin.binId).toBeDefined();
  });
});

describe("Integration: Transaction Building", () => {
  test.skip("can build leverage transaction (simulation only)", async () => {
    // This test only verifies transaction building, not submission
    const params = {
      connection,
      user: testWallet,
      baseAsset: "USDC" as const,
      baseAmount: 100,
      targetLeverage: 2,
      poolAddress: DLMM_POOLS.SOL_USDC,
      binRange: 10,
    };

    const result = await buildLeverageTransaction(params);

    expect(result.transaction).toBeDefined();
    expect(result.positionAddress).toBeDefined();
    expect(result.summary.effectiveLeverage).toBe(2);
    expect(result.summary.totalPositionSize).toBe(200);
  });
});

// ============ Run Tests ============

// Simple test runner for environments without Jest
async function runTests() {
  console.log("🧪 Running MnM Leverage Tests\n");

  let passed = 0;
  let failed = 0;

  // Test 1: Leverage calculations
  console.log("Test: calculateLeverageAmounts");
  try {
    const result = calculateLeverageAmounts(100, 2, {
      baseAssetPrice: 100,
      quoteAssetPrice: 1,
    });
    if (result.totalPositionSize === 200 && result.borrowRequired === 100) {
      console.log("  ✅ Passed");
      passed++;
    } else {
      throw new Error(
        `Expected 200/100, got ${result.totalPositionSize}/${result.borrowRequired}`,
      );
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${e}`);
    failed++;
  }

  // Test 2: Validate params
  console.log("Test: validateLeverageParams");
  try {
    const valid = validateLeverageParams(3, 100);
    const invalid = validateLeverageParams(10, 100);
    if (valid.valid === true && invalid.valid === false) {
      console.log("  ✅ Passed");
      passed++;
    } else {
      throw new Error("Validation logic incorrect");
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${e}`);
    failed++;
  }

  // Test 3: Health factor
  console.log("Test: calculateHealthFactor");
  try {
    const hf = calculateHealthFactor(1000, 500);
    if (Math.abs(hf - 1.7) < 0.01) {
      console.log("  ✅ Passed");
      passed++;
    } else {
      throw new Error(`Expected ~1.7, got ${hf}`);
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${e}`);
    failed++;
  }

  // Test 4: LTV calculation
  console.log("Test: calculateLTV");
  try {
    const ltv = calculateLTV(1000, 800);
    if (Math.abs(ltv - 0.8) < 0.01) {
      console.log("  ✅ Passed");
      passed++;
    } else {
      throw new Error(`Expected 0.8, got ${ltv}`);
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${e}`);
    failed++;
  }

  // Test 5: Risk status
  console.log("Test: Position risk status");
  try {
    const healthy = calculatePositionRisk(1000, 400, 100);
    const danger = calculatePositionRisk(1000, 800, 100);
    if (
      healthy.status === "healthy" &&
      (danger.status === "danger" || danger.status === "warning")
    ) {
      console.log("  ✅ Passed");
      passed++;
    } else {
      throw new Error(
        `Unexpected statuses: ${healthy.status}, ${danger.status}`,
      );
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${e}`);
    failed++;
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Run if executed directly
if (require.main === module) {
  runTests().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

export { runTests };
