/**
 * API Configuration
 * Centralized configuration with environment variable handling
 */

// ============ Environment Helpers ============

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.toLowerCase();
  if (!value) return defaultValue;
  return value === "true" || value === "1";
}

function getEnvList(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ============ Configuration ============

export const config = {
  // Server
  server: {
    port: getEnvNumber("PORT", 3456),
    host: getEnv("HOST", "0.0.0.0"),
    env: getEnv("NODE_ENV", "development"),
  },

  // Solana
  solana: {
    rpcUrl: getEnv("SOLANA_RPC", "https://api.mainnet-beta.solana.com"),
    rpcDevnet: getEnv("SOLANA_RPC_DEVNET", "https://api.devnet.solana.com"),
    commitment: getEnv("SOLANA_COMMITMENT", "confirmed") as
      | "processed"
      | "confirmed"
      | "finalized",
  },

  // Arcium
  arcium: {
    clusterOffset: getEnvNumber("ARCIUM_CLUSTER_OFFSET", 456),
    useDevnet: getEnvBoolean("ARCIUM_DEVNET", true),
  },

  // Rate Limiting
  rateLimit: {
    enabled: getEnvBoolean("RATE_LIMIT_ENABLED", true),
    windowMs: getEnvNumber("RATE_LIMIT_WINDOW_MS", 60000),
    maxRequests: getEnvNumber("RATE_LIMIT_MAX_REQUESTS", 100),
    txMaxRequests: getEnvNumber("RATE_LIMIT_TX_MAX", 10),
  },

  // Authentication
  auth: {
    apiKeys: getEnvList("API_KEYS"),
    requireAuth: getEnvBoolean("REQUIRE_AUTH", false),
  },

  // Logging
  logging: {
    level: getEnv("LOG_LEVEL", "info"),
    format: getEnv("LOG_FORMAT", "pretty"), // 'pretty' or 'json'
  },

  // Fetch/HTTP
  http: {
    timeout: getEnvNumber("HTTP_TIMEOUT", 10000),
    retries: getEnvNumber("HTTP_RETRIES", 2),
    retryDelay: getEnvNumber("HTTP_RETRY_DELAY", 1000),
  },

  // DEX APIs
  dex: {
    meteora: {
      apiUrl: getEnv("METEORA_API_URL", "https://dlmm-api.meteora.ag"),
      enabled: getEnvBoolean("METEORA_ENABLED", true),
    },
    orca: {
      apiUrl: getEnv("ORCA_API_URL", "https://api.mainnet.orca.so"),
      enabled: getEnvBoolean("ORCA_ENABLED", true),
    },
    raydium: {
      apiUrl: getEnv("RAYDIUM_API_URL", "https://api-v3.raydium.io"),
      enabled: getEnvBoolean("RAYDIUM_ENABLED", true),
    },
  },

  // Feature Flags
  features: {
    encryption: getEnvBoolean("FEATURE_ENCRYPTION", true),
    monitoring: getEnvBoolean("FEATURE_MONITORING", true),
    txBuilding: getEnvBoolean("FEATURE_TX_BUILDING", true),
  },
};

// ============ Validation ============

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate RPC URL
  if (!config.solana.rpcUrl.startsWith("http")) {
    errors.push("SOLANA_RPC must be a valid HTTP(S) URL");
  }

  // Validate port
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push("PORT must be between 1 and 65535");
  }

  // Validate log level
  const validLogLevels = ["debug", "info", "warn", "error"];
  if (!validLogLevels.includes(config.logging.level)) {
    errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============ Info ============

export function getConfigSummary(): Record<string, any> {
  return {
    server: {
      port: config.server.port,
      env: config.server.env,
    },
    solana: {
      rpc: config.solana.rpcUrl.slice(0, 30) + "...",
      commitment: config.solana.commitment,
    },
    arcium: {
      cluster: config.arcium.clusterOffset,
      devnet: config.arcium.useDevnet,
    },
    rateLimit: {
      enabled: config.rateLimit.enabled,
      maxRequests: config.rateLimit.maxRequests,
    },
    auth: {
      required: config.auth.requireAuth,
      keysConfigured: config.auth.apiKeys.length,
    },
    features: config.features,
  };
}

// ============ Environment File Template ============

export const ENV_TEMPLATE = `
# LP Toolkit API Configuration

# Server
PORT=3456
HOST=0.0.0.0
NODE_ENV=development

# Solana
SOLANA_RPC=https://api.mainnet-beta.solana.com
SOLANA_RPC_DEVNET=https://api.devnet.solana.com
SOLANA_COMMITMENT=confirmed

# Arcium
ARCIUM_CLUSTER_OFFSET=456
ARCIUM_DEVNET=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_TX_MAX=10

# Authentication (comma-separated API keys)
# API_KEYS=key1,key2,key3
REQUIRE_AUTH=false

# Logging
LOG_LEVEL=info
LOG_FORMAT=pretty

# HTTP Settings
HTTP_TIMEOUT=10000
HTTP_RETRIES=2
HTTP_RETRY_DELAY=1000

# Feature Flags
FEATURE_ENCRYPTION=true
FEATURE_MONITORING=true
FEATURE_TX_BUILDING=true
`.trim();

export default config;
