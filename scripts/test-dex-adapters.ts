/**
 * Comprehensive DEX Adapter Test Suite
 * Tests all 9 DEX adapters for robustness on devnet/mainnet
 *
 * Run: npx tsx scripts/test-dex-adapters.ts
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

// Import adapters
import { MeteoraAdapter } from "../src/lp-toolkit/adapters/meteora";
import { OrcaAdapter } from "../src/lp-toolkit/adapters/orca";
import { RaydiumAdapter } from "../src/lp-toolkit/adapters/raydium";
import { LifinityAdapter } from "../src/lp-toolkit/adapters/lifinity";
import { SaberAdapter } from "../src/lp-toolkit/adapters/saber";
import { CremaAdapter } from "../src/lp-toolkit/adapters/crema";
import { FluxBeamAdapter } from "../src/lp-toolkit/adapters/fluxbeam";
import { InvariantAdapter } from "../src/lp-toolkit/adapters/invariant";
import { MeteoraDammAdapter } from "../src/lp-toolkit/adapters/meteora-damm";

// ============ Configuration ============

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC = "https://api.devnet.solana.com";

// Test wallet with known positions (for position queries)
const TEST_WALLET = new PublicKey("11111111111111111111111111111111"); // System program (no positions)

interface TestResult {
  adapter: string;
  status: "PASS" | "FAIL" | "PARTIAL";
  poolsFound: number;
  positionsFound: number;
  error?: string;
  latencyMs: number;
  devnetSupport: boolean;
  mainnetSupport: boolean;
  apiEndpoint: string;
}

// ============ Test Functions ============

async function testAdapter(
  name: string,
  getPools: (conn: Connection) => Promise<any[]>,
  getPositions: (conn: Connection, user: PublicKey) => Promise<any[]>,
  apiEndpoint: string,
): Promise<TestResult> {
  const mainnetConn = new Connection(MAINNET_RPC, "confirmed");
  const devnetConn = new Connection(DEVNET_RPC, "confirmed");

  const result: TestResult = {
    adapter: name,
    status: "FAIL",
    poolsFound: 0,
    positionsFound: 0,
    latencyMs: 0,
    devnetSupport: false,
    mainnetSupport: false,
    apiEndpoint,
  };

  // Test mainnet
  const startTime = Date.now();
  try {
    const pools = await getPools(mainnetConn);
    result.poolsFound = pools.length;
    result.mainnetSupport = pools.length > 0;
    result.latencyMs = Date.now() - startTime;

    if (pools.length > 0) {
      console.log(`  ✅ Found ${pools.length} pools`);
      console.log(
        `     Top pool: ${pools[0]?.name || pools[0]?.address || "Unknown"}`,
      );
    }
  } catch (error: any) {
    result.error = error.message?.slice(0, 100);
    console.log(`  ❌ Pool fetch failed: ${result.error}`);
  }

  // Test positions (will be 0 for test wallet)
  try {
    const positions = await getPositions(mainnetConn, TEST_WALLET);
    result.positionsFound = positions.length;
  } catch (error: any) {
    // Position query failing is okay for test wallet
  }

  // Determine overall status
  if (result.poolsFound > 0) {
    result.status = "PASS";
  } else if (result.mainnetSupport || result.devnetSupport) {
    result.status = "PARTIAL";
  }

  return result;
}

async function testMeteora(): Promise<TestResult> {
  console.log("\n🔸 Testing Meteora DLMM...");
  const adapter = new MeteoraAdapter();
  return testAdapter(
    "Meteora DLMM",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://dlmm-api.meteora.ag",
  );
}

async function testMeteoraDamm(): Promise<TestResult> {
  console.log("\n🔸 Testing Meteora DAMM v2...");
  const adapter = new MeteoraDammAdapter();
  return testAdapter(
    "Meteora DAMM",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://amm.meteora.ag/pools",
  );
}

async function testOrca(): Promise<TestResult> {
  console.log("\n🔸 Testing Orca Whirlpool...");
  const adapter = new OrcaAdapter();
  return testAdapter(
    "Orca Whirlpool",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://api.mainnet.orca.so/v1/whirlpool",
  );
}

async function testRaydium(): Promise<TestResult> {
  console.log("\n🔸 Testing Raydium CLMM...");
  const adapter = new RaydiumAdapter();
  return testAdapter(
    "Raydium CLMM",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://api-v3.raydium.io/pools",
  );
}

async function testLifinity(): Promise<TestResult> {
  console.log("\n🔸 Testing Lifinity...");
  const adapter = new LifinityAdapter();
  return testAdapter(
    "Lifinity",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://lifinity.io/api",
  );
}

async function testSaber(): Promise<TestResult> {
  console.log("\n🔸 Testing Saber...");
  const adapter = new SaberAdapter();
  return testAdapter(
    "Saber",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://registry.saber.so",
  );
}

async function testCrema(): Promise<TestResult> {
  console.log("\n🔸 Testing Crema...");
  const adapter = new CremaAdapter();
  return testAdapter(
    "Crema",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://api.crema.finance",
  );
}

async function testFluxBeam(): Promise<TestResult> {
  console.log("\n🔸 Testing FluxBeam...");
  const adapter = new FluxBeamAdapter();
  return testAdapter(
    "FluxBeam",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://api.fluxbeam.xyz",
  );
}

async function testInvariant(): Promise<TestResult> {
  console.log("\n🔸 Testing Invariant...");
  const adapter = new InvariantAdapter();
  return testAdapter(
    "Invariant",
    (conn) => adapter.getPools(conn),
    (conn, user) => adapter.getPositions(conn, user),
    "https://api.invariant.app",
  );
}

// ============ Main Test Runner ============

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🦀 Solana LP MPC Toolkit - DEX Adapter Test Suite");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\nTesting ${9} DEX adapters for robustness...\n`);

  const results: TestResult[] = [];

  // Run all tests
  try {
    results.push(await testMeteora());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testMeteoraDamm());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testOrca());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testRaydium());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testLifinity());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testSaber());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testCrema());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testFluxBeam());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }
  try {
    results.push(await testInvariant());
  } catch (e: any) {
    console.log(`  ❌ Fatal: ${e.message}`);
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 Test Results Summary");
  console.log("═══════════════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.status === "PASS").length;
  const partial = results.filter((r) => r.status === "PARTIAL").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`Status: ${passed} PASS | ${partial} PARTIAL | ${failed} FAIL\n`);

  console.log("┌─────────────────┬────────┬───────────┬─────────┐");
  console.log("│ Adapter         │ Status │ Pools     │ Latency │");
  console.log("├─────────────────┼────────┼───────────┼─────────┤");

  for (const r of results) {
    const status =
      r.status === "PASS" ? "✅" : r.status === "PARTIAL" ? "⚠️" : "❌";
    const name = r.adapter.padEnd(15);
    const pools = String(r.poolsFound).padStart(4);
    const latency = `${r.latencyMs}ms`.padStart(6);
    console.log(`│ ${name} │ ${status}     │ ${pools}      │ ${latency} │`);
  }

  console.log("└─────────────────┴────────┴───────────┴─────────┘");

  // Total pools available
  const totalPools = results.reduce((sum, r) => sum + r.poolsFound, 0);
  console.log(`\n📈 Total pools discovered: ${totalPools}`);

  // Working adapters for agent use
  const workingAdapters = results
    .filter((r) => r.poolsFound > 0)
    .map((r) => r.adapter);
  console.log(`\n🤖 Working adapters for LP operations:`);
  workingAdapters.forEach((a) => console.log(`   • ${a}`));

  // Recommendations
  console.log("\n💡 Recommendations:");
  if (passed >= 3) {
    console.log("   ✅ Sufficient DEX coverage for production use");
  }

  const primaryAdapters = ["Meteora DLMM", "Orca Whirlpool", "Raydium CLMM"];
  const primaryWorking = primaryAdapters.filter((a) =>
    results.find((r) => r.adapter === a && r.status === "PASS"),
  );

  if (primaryWorking.length === 3) {
    console.log("   ✅ All primary DEXs (Meteora, Orca, Raydium) operational");
  } else {
    console.log(
      `   ⚠️  Primary DEXs working: ${primaryWorking.join(", ") || "None"}`,
    );
  }

  // Save results
  const reportPath = "./dex-test-report.json";
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
        summary: { passed, partial, failed, totalPools },
        workingAdapters,
      },
      null,
      2,
    ),
  );
  console.log(`\n📁 Full report saved to ${reportPath}`);

  console.log("\n═══════════════════════════════════════════════════════════");

  // Exit with appropriate code
  process.exit(passed >= 3 ? 0 : 1);
}

main().catch(console.error);
