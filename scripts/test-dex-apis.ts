/**
 * Direct DEX API Test
 * Tests all DEX APIs without SDK dependencies
 *
 * Run: npx tsx scripts/test-dex-apis.ts
 */

interface APITestResult {
  name: string;
  endpoint: string;
  status: "PASS" | "FAIL";
  poolsFound: number;
  latencyMs: number;
  error?: string;
  samplePool?: string;
}

async function testAPI(
  name: string,
  endpoint: string,
  parseResponse: (data: any) => { pools: any[]; sample: string },
): Promise<APITestResult> {
  const result: APITestResult = {
    name,
    endpoint,
    status: "FAIL",
    poolsFound: 0,
    latencyMs: 0,
  };

  const start = Date.now();

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    result.latencyMs = Date.now() - start;

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const data = await response.json();
    const { pools, sample } = parseResponse(data);

    result.poolsFound = pools.length;
    result.samplePool = sample;
    result.status = pools.length > 0 ? "PASS" : "FAIL";
  } catch (error: any) {
    result.latencyMs = Date.now() - start;
    result.error = error.message?.slice(0, 50);
  }

  return result;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🦀 Solana LP MPC Toolkit - DEX API Connectivity Test");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(
    "\nTesting direct API connectivity for all 9 DEX integrations...\n",
  );

  const results: APITestResult[] = [];

  // 1. Meteora DLMM
  console.log("🔸 Meteora DLMM...");
  results.push(
    await testAPI(
      "Meteora DLMM",
      "https://dlmm-api.meteora.ag/pair/all",
      (data) => ({
        pools: Array.isArray(data) ? data : [],
        sample: data[0]?.name || "N/A",
      }),
    ),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms)`,
  );

  // 2. Meteora DAMM
  console.log("🔸 Meteora DAMM v2...");
  results.push(
    await testAPI("Meteora DAMM", "https://amm.meteora.ag/pools", (data) => ({
      pools: Array.isArray(data) ? data : [],
      sample: data[0]?.pool_name || "N/A",
    })),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms)`,
  );

  // 3. Orca Whirlpool
  console.log("🔸 Orca Whirlpool...");
  results.push(
    await testAPI(
      "Orca Whirlpool",
      "https://api.mainnet.orca.so/v1/whirlpool/list",
      (data) => ({
        pools: data.whirlpools || [],
        sample:
          data.whirlpools?.[0]?.tokenA?.symbol +
            "-" +
            data.whirlpools?.[0]?.tokenB?.symbol || "N/A",
      }),
    ),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms)`,
  );

  // 4. Raydium CLMM
  console.log("🔸 Raydium CLMM...");
  results.push(
    await testAPI(
      "Raydium CLMM",
      "https://api-v3.raydium.io/pools/info/list?poolType=concentrated&sort=tvl&order=desc&pageSize=100",
      (data) => ({
        pools: data.data?.data || [],
        sample: data.data?.data?.[0]?.poolName || "N/A",
      }),
    ),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms)`,
  );

  // 5. Lifinity
  console.log("🔸 Lifinity...");
  results.push(
    await testAPI("Lifinity", "https://lifinity.io/api/pools", (data) => ({
      pools: Array.isArray(data) ? data : data.pools || [],
      sample: data[0]?.name || data.pools?.[0]?.name || "N/A",
    })),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms) ${results[results.length - 1].error || ""}`,
  );

  // 6. Saber
  console.log("🔸 Saber...");
  results.push(
    await testAPI(
      "Saber",
      "https://registry.saber.so/data/pools-info.mainnet.json",
      (data) => ({
        pools: data.pools || [],
        sample: data.pools?.[0]?.name || "N/A",
      }),
    ),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms)`,
  );

  // 7. Crema
  console.log("🔸 Crema...");
  results.push(
    await testAPI(
      "Crema",
      "https://api.crema.finance/v2/swap/pairs",
      (data) => ({
        pools: data.data || [],
        sample: data.data?.[0]?.name || "N/A",
      }),
    ),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms) ${results[results.length - 1].error || ""}`,
  );

  // 8. FluxBeam
  console.log("🔸 FluxBeam...");
  results.push(
    await testAPI("FluxBeam", "https://api.fluxbeam.xyz/v1/pools", (data) => ({
      pools: Array.isArray(data) ? data : data.pools || [],
      sample: data[0]?.name || "N/A",
    })),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms) ${results[results.length - 1].error || ""}`,
  );

  // 9. Invariant
  console.log("🔸 Invariant...");
  results.push(
    await testAPI(
      "Invariant",
      "https://api.invariant.app/solana-mainnet/pools",
      (data) => ({
        pools: Array.isArray(data) ? data : data.pools || [],
        sample: data[0]?.pair || "N/A",
      }),
    ),
  );
  console.log(
    `   ${results[results.length - 1].status === "PASS" ? "✅" : "❌"} ${results[results.length - 1].poolsFound} pools (${results[results.length - 1].latencyMs}ms) ${results[results.length - 1].error || ""}`,
  );

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 API Connectivity Summary");
  console.log("═══════════════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.status === "PASS");
  const failed = results.filter((r) => r.status === "FAIL");

  console.log(`✅ Working: ${passed.length}/9 DEX APIs`);
  console.log(`❌ Failed:  ${failed.length}/9 DEX APIs\n`);

  console.log(
    "┌──────────────────┬────────┬────────────┬─────────┬────────────────────┐",
  );
  console.log(
    "│ DEX              │ Status │ Pools      │ Latency │ Sample Pool        │",
  );
  console.log(
    "├──────────────────┼────────┼────────────┼─────────┼────────────────────┤",
  );

  for (const r of results) {
    const status = r.status === "PASS" ? "✅" : "❌";
    const name = r.name.padEnd(16);
    const pools = String(r.poolsFound).padStart(5);
    const latency = `${r.latencyMs}ms`.padStart(6);
    const sample = (r.samplePool || r.error || "N/A").slice(0, 18).padEnd(18);
    console.log(
      `│ ${name} │ ${status}     │ ${pools}      │ ${latency} │ ${sample} │`,
    );
  }

  console.log(
    "└──────────────────┴────────┴────────────┴─────────┴────────────────────┘",
  );

  // Total pools
  const totalPools = results.reduce((sum, r) => sum + r.poolsFound, 0);
  console.log(`\n📈 Total LP pools available: ${totalPools.toLocaleString()}`);

  // Production readiness
  const primaryDEXs = ["Meteora DLMM", "Orca Whirlpool", "Raydium CLMM"];
  const primaryWorking = primaryDEXs.filter((name) =>
    results.find((r) => r.name === name && r.status === "PASS"),
  );

  console.log("\n🏭 Production Readiness:");
  if (primaryWorking.length >= 2) {
    console.log("   ✅ Primary DEXs operational - ready for production");
    console.log(`   ✅ Working: ${primaryWorking.join(", ")}`);
  } else {
    console.log("   ⚠️  Some primary DEXs unavailable");
  }

  if (passed.length >= 5) {
    console.log("   ✅ Sufficient DEX coverage for diverse LP opportunities");
  }

  // Devnet note
  console.log(
    "\n📝 Note: These APIs are for mainnet pools. Devnet testing uses:",
  );
  console.log("   • Simulated transactions (no real liquidity needed)");
  console.log("   • Arcium devnet cluster 456 for privacy layer");
  console.log("   • SDK-based position management with devnet RPC");

  console.log("\n═══════════════════════════════════════════════════════════");

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: 9,
      passed: passed.length,
      failed: failed.length,
      totalPools,
    },
  };

  require("fs").writeFileSync(
    "./dex-api-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("📁 Report saved to dex-api-report.json");
}

main().catch(console.error);
