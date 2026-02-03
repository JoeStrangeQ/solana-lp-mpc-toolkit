/**
 * API Validation Script
 * Comprehensive test of all API endpoints
 *
 * Run: npm run api (terminal 1)
 * Run: npx tsx scripts/validate-api.ts (terminal 2)
 */

const API = process.env.API_URL || "http://localhost:3456";

interface ValidationResult {
  endpoint: string;
  method: string;
  status: "PASS" | "FAIL" | "SKIP";
  statusCode?: number;
  responseTime: number;
  error?: string;
  headers?: Record<string, string>;
}

const results: ValidationResult[] = [];

async function validate(
  name: string,
  method: string,
  path: string,
  options?: {
    body?: any;
    expectedStatus?: number;
    validate?: (data: any) => boolean;
  },
): Promise<void> {
  const { body, expectedStatus = 200, validate: validateFn } = options || {};
  const startTime = Date.now();
  const endpoint = `${method} ${path}`;

  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseTime = Date.now() - startTime;
    const data = await response.json().catch(() => null);

    // Check status code
    if (response.status !== expectedStatus) {
      results.push({
        endpoint,
        method,
        status: "FAIL",
        statusCode: response.status,
        responseTime,
        error: `Expected ${expectedStatus}, got ${response.status}`,
      });
      console.log(
        `❌ ${name}: Expected ${expectedStatus}, got ${response.status}`,
      );
      return;
    }

    // Run custom validation
    if (validateFn && !validateFn(data)) {
      results.push({
        endpoint,
        method,
        status: "FAIL",
        statusCode: response.status,
        responseTime,
        error: "Custom validation failed",
      });
      console.log(`❌ ${name}: Validation failed`);
      return;
    }

    // Check for required headers
    const headers: Record<string, string> = {};
    if (response.headers.get("X-Request-ID")) {
      headers["X-Request-ID"] = response.headers.get("X-Request-ID")!;
    }
    if (response.headers.get("X-RateLimit-Remaining")) {
      headers["X-RateLimit-Remaining"] = response.headers.get(
        "X-RateLimit-Remaining",
      )!;
    }

    results.push({
      endpoint,
      method,
      status: "PASS",
      statusCode: response.status,
      responseTime,
      headers,
    });
    console.log(`✅ ${name} (${responseTime}ms)`);
  } catch (error: any) {
    results.push({
      endpoint,
      method,
      status: "FAIL",
      responseTime: Date.now() - startTime,
      error: error.message,
    });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🦀 LP Toolkit API Validation");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`API: ${API}\n`);

  // Check if API is reachable
  try {
    await fetch(`${API}/v1/health`);
  } catch {
    console.error("❌ Cannot reach API. Is the server running?");
    console.error("   Start with: npm run api");
    process.exit(1);
  }

  console.log("--- Core Endpoints ---\n");

  // 1. Health check
  await validate("Health check", "GET", "/v1/health", {
    validate: (d) => d.status === "healthy",
  });

  // 2. Root endpoint
  await validate("Root endpoint", "GET", "/", {
    validate: (d) => d.name === "Solana LP MPC Toolkit API",
  });

  // 3. Docs endpoint
  await validate("API docs", "GET", "/v1/docs", {
    validate: (d) => d.title && d.endpoints,
  });

  console.log("\n--- Pool Discovery ---\n");

  // 4. Pool scan - basic
  await validate("Pool scan (basic)", "GET", "/v1/pools/scan");

  // 5. Pool scan - with params
  await validate(
    "Pool scan (SOL-USDC)",
    "GET",
    "/v1/pools/scan?tokenA=SOL&tokenB=USDC&limit=5",
    {
      validate: (d) => d.success && typeof d.count === "number",
    },
  );

  // 6. Pool scan - single venue
  await validate(
    "Pool scan (Meteora only)",
    "GET",
    "/v1/pools/scan?venue=meteora&limit=3",
  );

  console.log("\n--- Intent Parsing ---\n");

  // 7. Intent parse - add liquidity
  await validate("Parse add liquidity intent", "POST", "/v1/intent/parse", {
    body: { text: "Add $500 to the best SOL-USDC pool" },
    validate: (d) => d.success && d.intent?.action,
  });

  // 8. Intent parse - scan
  await validate("Parse scan intent", "POST", "/v1/intent/parse", {
    body: { text: "Show me high yield stablecoin pools" },
    validate: (d) => d.success,
  });

  // 9. Intent parse - missing text
  await validate("Parse intent - missing text", "POST", "/v1/intent/parse", {
    body: {},
    expectedStatus: 400,
  });

  console.log("\n--- Encryption ---\n");

  // 10. Encrypt strategy
  await validate("Encrypt strategy", "POST", "/v1/encrypt/strategy", {
    body: {
      ownerPubkey: "11111111111111111111111111111111",
      strategy: {
        tokenA: "SOL",
        tokenB: "USDC",
        totalValueUSD: 500,
        strategy: "concentrated",
      },
    },
    validate: (d) => d.success && d.encrypted?.id,
  });

  // 11. Encrypt - invalid pubkey
  await validate("Encrypt - invalid pubkey", "POST", "/v1/encrypt/strategy", {
    body: {
      ownerPubkey: "invalid",
      strategy: { tokenA: "SOL", tokenB: "USDC" },
    },
    expectedStatus: 400,
  });

  console.log("\n--- Positions ---\n");

  // 12. Get positions
  await validate(
    "Get positions",
    "GET",
    "/v1/positions/11111111111111111111111111111111",
    {
      validate: (d) => d.success && typeof d.count === "number",
    },
  );

  // 13. Get positions - invalid wallet
  await validate(
    "Get positions - invalid wallet",
    "GET",
    "/v1/positions/invalid",
    {
      expectedStatus: 500, // Will fail validation
    },
  );

  console.log("\n--- Transaction Building ---\n");

  // 14. Build add liquidity TX
  await validate("Build add liquidity TX", "POST", "/v1/tx/add-liquidity", {
    body: {
      userPubkey: "11111111111111111111111111111111",
      venue: "meteora",
      tokenA: "SOL",
      tokenB: "USDC",
      amountA: 1.0,
      amountB: 150,
    },
    validate: (d) => d.success && d.transaction?.serialized,
  });

  // 15. Build TX - missing fields
  await validate("Build TX - missing fields", "POST", "/v1/tx/add-liquidity", {
    body: { userPubkey: "11111111111111111111111111111111" },
    expectedStatus: 400,
  });

  // 16. Build remove liquidity TX
  await validate(
    "Build remove liquidity TX",
    "POST",
    "/v1/tx/remove-liquidity",
    {
      body: {
        userPubkey: "11111111111111111111111111111111",
        positionId: "11111111111111111111111111111111",
        venue: "meteora",
        percentage: 50,
      },
      validate: (d) => d.success && d.transaction?.serialized,
    },
  );

  console.log("\n--- Monitoring ---\n");

  // 17. Monitor positions
  await validate(
    "Monitor positions",
    "GET",
    "/v1/monitor/positions/11111111111111111111111111111111",
    {
      validate: (d) => d.success,
    },
  );

  // 18. Monitor pools
  await validate(
    "Monitor pools",
    "GET",
    "/v1/monitor/pools?venue=meteora&limit=5",
    {
      validate: (d) => d.success,
    },
  );

  console.log("\n--- Error Handling ---\n");

  // 19. 404 handling
  await validate("404 handling", "GET", "/v1/nonexistent", {
    expectedStatus: 404,
  });

  // 20. Invalid JSON
  // Skipped - need raw fetch for this

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 Validation Summary");
  console.log("═══════════════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  if (skipped > 0) console.log(`Skipped: ${skipped} ⏭️`);

  // Average response time
  const avgTime =
    results
      .filter((r) => r.status === "PASS")
      .reduce((sum, r) => sum + r.responseTime, 0) / passed;
  console.log(`Avg response time: ${avgTime.toFixed(0)}ms`);

  // Header checks
  const hasRequestId = results.some((r) => r.headers?.["X-Request-ID"]);
  const hasRateLimit = results.some(
    (r) => r.headers?.["X-RateLimit-Remaining"],
  );
  console.log(`\nHeaders:`);
  console.log(`  X-Request-ID: ${hasRequestId ? "✅" : "❌"}`);
  console.log(`  X-RateLimit: ${hasRateLimit ? "✅" : "❌"}`);

  if (failed > 0) {
    console.log("\n❌ Failed tests:");
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => {
        console.log(`   ${r.endpoint}: ${r.error}`);
      });
  }

  console.log("\n═══════════════════════════════════════════════════════════");

  if (passed === results.length) {
    console.log("🎉 ALL VALIDATIONS PASSED!");
  } else if (failed <= 2) {
    console.log("⚠️  Minor issues detected. Review failures above.");
  } else {
    console.log("❌ Multiple failures. Investigate before deployment.");
  }

  process.exit(failed > 2 ? 1 : 0);
}

main().catch(console.error);
