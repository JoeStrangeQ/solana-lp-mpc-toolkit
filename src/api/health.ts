/**
 * Health Check Service
 * Deep health checks for all dependencies
 */

import { Connection } from "@solana/web3.js";
import { safeFetch } from "./fetch";
import config from "./config";
import { ARCIUM_DEVNET_CONFIG } from "../lp-toolkit/services/arciumPrivacy";

// ============ Types ============

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  latencyMs?: number;
  message?: string;
  details?: Record<string, any>;
}

// ============ Start Time ============

const startTime = Date.now();

// ============ Health Checks ============

/**
 * Check Solana RPC connectivity
 */
async function checkSolanaRpc(): Promise<HealthCheck> {
  const start = Date.now();

  try {
    const connection = new Connection(
      config.solana.rpcUrl,
      config.solana.commitment,
    );
    const slot = await connection.getSlot();

    return {
      name: "solana_rpc",
      status: "pass",
      latencyMs: Date.now() - start,
      details: { slot, rpc: config.solana.rpcUrl.slice(0, 30) + "..." },
    };
  } catch (error: any) {
    return {
      name: "solana_rpc",
      status: "fail",
      latencyMs: Date.now() - start,
      message: error.message,
    };
  }
}

/**
 * Check Meteora API
 */
async function checkMeteoraApi(): Promise<HealthCheck> {
  const start = Date.now();

  const result = await safeFetch(`${config.dex.meteora.apiUrl}/pair/all`, {
    timeout: 5000,
    retries: 0,
  });

  if (result.success) {
    const poolCount = Array.isArray(result.data) ? result.data.length : 0;
    return {
      name: "meteora_api",
      status: "pass",
      latencyMs: result.durationMs,
      details: { poolCount },
    };
  }

  return {
    name: "meteora_api",
    status: "fail",
    latencyMs: result.durationMs,
    message: result.error,
  };
}

/**
 * Check Orca API
 */
async function checkOrcaApi(): Promise<HealthCheck> {
  const result = await safeFetch(
    `${config.dex.orca.apiUrl}/v1/whirlpool/list`,
    {
      timeout: 5000,
      retries: 0,
    },
  );

  if (result.success) {
    const poolCount = result.data?.whirlpools?.length || 0;
    return {
      name: "orca_api",
      status: "pass",
      latencyMs: result.durationMs,
      details: { poolCount },
    };
  }

  return {
    name: "orca_api",
    status: "warn", // Orca is optional
    latencyMs: result.durationMs,
    message: result.error,
  };
}

/**
 * Check Arcium configuration
 */
async function checkArcium(): Promise<HealthCheck> {
  try {
    // Verify we have the MXE public key
    const hasKey = ARCIUM_DEVNET_CONFIG.mxePublicKey.length === 32;

    if (hasKey) {
      return {
        name: "arcium",
        status: "pass",
        details: {
          cluster: ARCIUM_DEVNET_CONFIG.clusterOffset,
          keyPrefix: ARCIUM_DEVNET_CONFIG.mxePublicKeyHex.slice(0, 16),
        },
      };
    }

    return {
      name: "arcium",
      status: "fail",
      message: "MXE public key not configured",
    };
  } catch (error: any) {
    return {
      name: "arcium",
      status: "fail",
      message: error.message,
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory(): HealthCheck {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const usagePercent = Math.round((used.heapUsed / used.heapTotal) * 100);

  return {
    name: "memory",
    status: usagePercent > 90 ? "warn" : "pass",
    details: {
      heapUsedMB,
      heapTotalMB,
      usagePercent,
    },
  };
}

// ============ Main Health Check ============

/**
 * Run all health checks
 */
export async function runHealthChecks(): Promise<HealthStatus> {
  const checks: HealthCheck[] = [];

  // Run checks in parallel where possible
  const [solana, meteora, orca, arcium] = await Promise.all([
    checkSolanaRpc(),
    checkMeteoraApi(),
    checkOrcaApi(),
    checkArcium(),
  ]);

  checks.push(solana, meteora, orca, arcium, checkMemory());

  // Determine overall status
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  let status: "healthy" | "degraded" | "unhealthy";
  if (failCount >= 2) {
    status = "unhealthy";
  } else if (failCount === 1 || warnCount >= 2) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    uptime: Math.round((Date.now() - startTime) / 1000),
    checks,
  };
}

/**
 * Quick health check (no external calls)
 */
export function quickHealthCheck(): HealthStatus {
  return {
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    uptime: Math.round((Date.now() - startTime) / 1000),
    checks: [checkMemory()],
  };
}

export default {
  runHealthChecks,
  quickHealthCheck,
};
