/**
 * API Configuration
 * Centralized configuration with environment variable handling
 */
// ============ Environment Helpers ============
function getEnv(key, defaultValue) {
    return process.env[key] || defaultValue;
}
function getEnvNumber(key, defaultValue) {
    var value = process.env[key];
    if (!value)
        return defaultValue;
    var num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
}
function getEnvBoolean(key, defaultValue) {
    var _a;
    var value = (_a = process.env[key]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (!value)
        return defaultValue;
    return value === "true" || value === "1";
}
function getEnvList(key, defaultValue) {
    if (defaultValue === void 0) { defaultValue = []; }
    var value = process.env[key];
    if (!value)
        return defaultValue;
    return value
        .split(",")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
}
// ============ Configuration ============
export var config = {
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
        commitment: getEnv("SOLANA_COMMITMENT", "confirmed"),
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
export function validateConfig() {
    var errors = [];
    // Validate RPC URL
    if (!config.solana.rpcUrl.startsWith("http")) {
        errors.push("SOLANA_RPC must be a valid HTTP(S) URL");
    }
    // Validate port
    if (config.server.port < 1 || config.server.port > 65535) {
        errors.push("PORT must be between 1 and 65535");
    }
    // Validate log level
    var validLogLevels = ["debug", "info", "warn", "error"];
    if (!validLogLevels.includes(config.logging.level)) {
        errors.push("LOG_LEVEL must be one of: ".concat(validLogLevels.join(", ")));
    }
    return {
        valid: errors.length === 0,
        errors: errors,
    };
}
// ============ Info ============
export function getConfigSummary() {
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
export var ENV_TEMPLATE = "\n# LP Toolkit API Configuration\n\n# Server\nPORT=3456\nHOST=0.0.0.0\nNODE_ENV=development\n\n# Solana\nSOLANA_RPC=https://api.mainnet-beta.solana.com\nSOLANA_RPC_DEVNET=https://api.devnet.solana.com\nSOLANA_COMMITMENT=confirmed\n\n# Arcium\nARCIUM_CLUSTER_OFFSET=456\nARCIUM_DEVNET=true\n\n# Rate Limiting\nRATE_LIMIT_ENABLED=true\nRATE_LIMIT_WINDOW_MS=60000\nRATE_LIMIT_MAX_REQUESTS=100\nRATE_LIMIT_TX_MAX=10\n\n# Authentication (comma-separated API keys)\n# API_KEYS=key1,key2,key3\nREQUIRE_AUTH=false\n\n# Logging\nLOG_LEVEL=info\nLOG_FORMAT=pretty\n\n# HTTP Settings\nHTTP_TIMEOUT=10000\nHTTP_RETRIES=2\nHTTP_RETRY_DELAY=1000\n\n# Feature Flags\nFEATURE_ENCRYPTION=true\nFEATURE_MONITORING=true\nFEATURE_TX_BUILDING=true\n".trim();
export default config;
