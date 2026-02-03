/**
 * DEX Adapter Live Test
 * Tests that DEX APIs are working and returning real data
 *
 * Run: node test-dex-live.cjs
 */

const https = require("https");
const http = require("http");

// Helper to fetch JSON
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { timeout: 10000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ error: "Invalid JSON", raw: data.slice(0, 100) });
          }
        });
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("Timeout")));
  });
}

async function testDEX(name, url, parser) {
  process.stdout.write(`   ${name}... `);
  try {
    const data = await fetchJSON(url);
    const result = parser(data);
    if (result.success) {
      console.log(`✅ ${result.pools} pools, top: ${result.topPool}`);
      return true;
    } else {
      console.log(`⚠️ ${result.error}`);
      return false;
    }
  } catch (e) {
    console.log(`❌ ${e.message}`);
    return false;
  }
}

async function main() {
  console.log("🔍 DEX Adapter Live Test\n");
  console.log("=".repeat(50));
  console.log("\nTesting API endpoints for real pool data...\n");

  let passed = 0;
  let total = 0;

  // Meteora DLMM
  total++;
  if (
    await testDEX(
      "Meteora DLMM",
      "https://dlmm-api.meteora.ag/pair/all",
      (data) => {
        if (Array.isArray(data) && data.length > 0) {
          const top = data.find(
            (p) => p.name?.includes("SOL") && p.name?.includes("USDC"),
          );
          return {
            success: true,
            pools: data.length,
            topPool: top?.name || data[0]?.name || "Unknown",
          };
        }
        return { success: false, error: "No pools returned" };
      },
    )
  )
    passed++;

  // Meteora DAMM v2
  total++;
  if (
    await testDEX(
      "Meteora DAMM v2",
      "https://amm-v2.meteora.ag/pools",
      (data) => {
        if (Array.isArray(data) && data.length > 0) {
          return {
            success: true,
            pools: data.length,
            topPool: data[0]?.pool_address?.slice(0, 8) || "Unknown",
          };
        }
        if (data.pools && Array.isArray(data.pools)) {
          return {
            success: true,
            pools: data.pools.length,
            topPool: "via pools array",
          };
        }
        return { success: false, error: "Unexpected format" };
      },
    )
  )
    passed++;

  // Orca Whirlpools
  total++;
  if (
    await testDEX(
      "Orca Whirlpool",
      "https://api.mainnet.orca.so/v1/whirlpool/list",
      (data) => {
        if (data.whirlpools && Array.isArray(data.whirlpools)) {
          const top = data.whirlpools.find(
            (p) => p.tokenA?.symbol === "SOL" && p.tokenB?.symbol === "USDC",
          );
          return {
            success: true,
            pools: data.whirlpools.length,
            topPool: top
              ? "SOL-USDC"
              : data.whirlpools[0]?.address?.slice(0, 8),
          };
        }
        return { success: false, error: "No whirlpools in response" };
      },
    )
  )
    passed++;

  // Raydium CLMM
  total++;
  if (
    await testDEX(
      "Raydium CLMM",
      "https://api-v3.raydium.io/pools/info/list?poolType=concentrated&pageSize=10",
      (data) => {
        if (data.success && data.data?.data) {
          return {
            success: true,
            pools: data.data.data.length,
            topPool: data.data.data[0]?.id?.slice(0, 8) || "Unknown",
          };
        }
        return { success: false, error: data.msg || "API error" };
      },
    )
  )
    passed++;

  // Lifinity
  total++;
  if (
    await testDEX("Lifinity", "https://lifinity.io/api/pools", (data) => {
      if (Array.isArray(data) && data.length > 0) {
        return {
          success: true,
          pools: data.length,
          topPool: data[0]?.name || "Unknown",
        };
      }
      if (data.pools) {
        return {
          success: true,
          pools: Object.keys(data.pools).length,
          topPool: "via pools object",
        };
      }
      // Lifinity API might require auth or different endpoint
      return { success: false, error: "No pools data" };
    })
  )
    passed++;

  // Saber
  total++;
  if (
    await testDEX(
      "Saber",
      "https://registry.saber.so/data/pools-info.mainnet.json",
      (data) => {
        if (data.pools && Array.isArray(data.pools)) {
          const top = data.pools.find(
            (p) => p.name?.includes("USDC") && p.name?.includes("USDT"),
          );
          return {
            success: true,
            pools: data.pools.length,
            topPool: top?.name || data.pools[0]?.name || "Unknown",
          };
        }
        return { success: false, error: "No pools array" };
      },
    )
  )
    passed++;

  // Invariant
  total++;
  if (
    await testDEX(
      "Invariant",
      "https://stats.invariant.app/pool_list/solana",
      (data) => {
        if (Array.isArray(data) && data.length > 0) {
          return {
            success: true,
            pools: data.length,
            topPool: `${data[0]?.symbolX}-${data[0]?.symbolY}` || "Unknown",
          };
        }
        return { success: false, error: "No pools returned" };
      },
    )
  )
    passed++;

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log(`\n📊 Results: ${passed}/${total} DEX APIs responding\n`);

  if (passed >= 4) {
    console.log("✅ Core DEX connectivity verified!");
    console.log("   Real pool data is accessible.\n");
  } else {
    console.log("⚠️ Some DEX APIs may be rate-limited or changed.");
    console.log("   Hardcoded fallback data will be used.\n");
  }
}

main().catch(console.error);
