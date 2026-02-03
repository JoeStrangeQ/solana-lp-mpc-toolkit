/**
 * LP Toolkit REST API Server
 * Enables agent-to-agent usage over HTTP
 *
 * Run: npx tsx src/api/server.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { Connection, PublicKey } from "@solana/web3.js";
import { ArciumPrivacyService, ARCIUM_DEVNET_CONFIG } from "../lp-toolkit/services/arciumPrivacy";
import { parseIntent, AddLiquidityIntent } from "../lp-toolkit/api/intentParser";
import { LPPool, formatPoolsForChat } from "../lp-toolkit/adapters/types";
import { buildAddLiquidityTx, buildRemoveLiquidityTx, describeTx } from "./txBuilder";
import { checkPositionHealth, checkPoolHealth, formatHealthReport, formatPoolReport } from './monitoring';
import { validateAddLiquidityRequest, validateEncryptRequest } from './validation';
import { safeFetch } from './fetch';
import { standardLimit, txLimit, readLimit, getRateLimitStats } from './rateLimit';
import * as log from './logger';
import { requestId, serverTiming, errorHandler, securityHeaders } from './middleware';
import { runHealthChecks, quickHealthCheck } from './health';
import { MeteoraApiPool, OrcaApiWhirlpool, MeteoraApiPosition } from './externalApiTypes';

// ============ Configuration ============

const PORT = process.env.PORT || 3456;
const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

const app = new Hono();
const connection = new Connection(SOLANA_RPC, "confirmed");

// ============ Middleware ============

app.use("*", cors());
app.use("*", requestId());
app.use("*", serverTiming());
app.use("*", errorHandler());
app.use("*", securityHeaders());

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.request(c.req.method, c.req.path, c.res.status, ms);
});

// ============ Health & Info ============

app.get("/", (c) => {
  return c.json({
    name: "Solana LP MPC Toolkit API",
    version: "1.0.0",
    description: "Privacy-preserving LP operations for AI agents",
    docs: "/v1/docs",
  });
});

app.use("/v1/*", standardLimit);

app.get("/v1/health", (c) => {
  const health = quickHealthCheck();
  return c.json({
    ...health,
    rateLimit: getRateLimitStats(),
  });
});

app.get("/v1/health/deep", async (c) => {
  const health = await runHealthChecks();
  const statusCode = health.status === "healthy" ? 200 : 503;
  return c.json(health, statusCode);
});

// ============ Pool Discovery ============

app.get("/v1/pools/scan", readLimit, async (c) => {
  const tokenA = c.req.query("tokenA") || "SOL";
  const tokenB = c.req.query("tokenB") || "USDC";
  const limit = parseInt(c.req.query("limit") || "10");
  const venue = c.req.query("venue");

  const pools: LPPool[] = [];

  // Meteora DLMM
  if (!venue || venue === "meteora") {
    const result = await safeFetch<MeteoraApiPool[]>("https://dlmm-api.meteora.ag/pair/all");
    if (result.success && result.data) {
      pools.push(...result.data.filter(p => p.name.toUpperCase().includes(tokenA.toUpperCase()) && p.name.toUpperCase().includes(tokenB.toUpperCase())).slice(0, 20).map(p => ({
        venue: 'meteora', address: p.address, name: p.name, apy: p.apr, apy7d: p.apr_7d, tvl: p.liquidity, volume24h: p.trade_volume_24h, fee: p.base_fee_percentage, tokenA: { mint: p.mint_x, symbol: '', decimals: 0 }, tokenB: { mint: p.mint_y, symbol: '', decimals: 0 }
      })));
    }
  }

  // Orca Whirlpool
  if (!venue || venue === "orca") {
    const result = await safeFetch<{whirlpools: OrcaApiWhirlpool[]}>("https://api.mainnet.orca.so/v1/whirlpool/list");
    if (result.success && result.data?.whirlpools) {
       pools.push(...result.data.whirlpools.filter(p => `${p.tokenA.symbol}-${p.tokenB.symbol}`.toUpperCase().includes(tokenA.toUpperCase()) && `${p.tokenA.symbol}-${p.tokenB.symbol}`.toUpperCase().includes(tokenB.toUpperCase())).slice(0, 20).map(p => ({
        venue: 'orca', address: p.address, name: `${p.tokenA.symbol}-${p.tokenB.symbol}`, apy: p.feeApr, apy7d: p.feeApr, tvl: p.tvl, volume24h: p.volume.day, fee: p.lpFeeRate * 100, tokenA: p.tokenA, tokenB: p.tokenB
      })));
    }
  }
  
  pools.sort((a, b) => b.apy - a.apy);
  const topPools = pools.slice(0, limit);

  return c.json({
    success: true,
    query: { tokenA, tokenB, limit, venue },
    count: topPools.length,
    pools: topPools,
    chatDisplay: formatPoolsForChat(topPools),
  });
});

// ============ Intent & Encryption ============

app.post("/v1/intent/parse", strictLimit, async (c) => {
  const { text } = await c.req.json<{text: string}>();
  if (!text) return c.json({ success: false, error: "Missing text" }, 400);
  const intent = parseIntent(text);
  return c.json({ success: true, intent });
});

app.post("/v1/encrypt/strategy", strictLimit, async (c) => {
  const validation = validateEncryptRequest(await c.req.json());
  if (!validation.valid) return c.json({ success: false, error: validation.error }, 400);

  const { ownerPubkey, strategy } = validation.sanitized as {ownerPubkey: string, strategy: AddLiquidityIntent};
  const privacy = new ArciumPrivacyService(new PublicKey(ownerPubkey));
  await privacy.initializeDevnet();
  const encrypted = privacy.encryptStrategy(strategy);

  return c.json({ success: true, encrypted });
});

// ============ Positions & Monitoring ============

app.get("/v1/positions/:wallet", readLimit, async (c) => {
  const wallet = c.req.param("wallet");
  const result = await safeFetch<MeteoraApiPosition[]>(`https://dlmm-api.meteora.ag/position/${wallet}`);
  if(!result.success || !result.data) return c.json({ success: false, error: result.error}, 500);

  const positions = result.data.map(p => ({
    venue: 'meteora', positionId: p.address, poolName: p.pair_name, valueUSD: p.total_value_usd, unclaimedFeesUSD: p.unclaimed_fee_usd
  }));
  return c.json({ success: true, positions });
});

app.get("/v1/monitor/positions/:wallet", strictLimit, async (c) => {
  const wallet = c.req.param("wallet");
  const result = await safeFetch<MeteoraApiPosition[]>(`https://dlmm-api.meteora.ag/position/${wallet}`);
  if(!result.success || !result.data) return c.json({ success: false, error: result.error}, 500);

  const healthReports = result.data.map(p => checkPositionHealth({
    positionId: p.address, poolName: p.pair_name, venue: 'meteora', currentPrice: p.current_price || 0, rangeMin: p.price_lower || 0, rangeMax: p.price_upper || 0, unclaimedFeesUSD: p.unclaimed_fee_usd
  }));
  return c.json({ success: true, healthReports, chatDisplay: formatHealthReport(healthReports) });
});

// ============ TX Building ============

app.post("/v1/tx/add-liquidity", txLimit, async (c) => {
  const validation = validateAddLiquidityRequest(await c.req.json());
  if (!validation.valid) return c.json({ success: false, error: validation.error }, 400);
  const result = await buildAddLiquidityTx(connection, validation.sanitized);
  return c.json(result);
});

app.post("/v1/tx/remove-liquidity", txLimit, async (c) => {
  const { userPubkey, positionId, venue, percentage } = await c.req.json();
  const result = await buildRemoveLiquidityTx(connection, { userPubkey, positionId, venue, percentage });
  return c.json(result);
});

app.post("/v1/tx/describe", strictLimit, async (c) => {
  const { serializedTx } = await c.req.json<{serializedTx: string}>();
  const description = describeTx(serializedTx);
  return c.json({ success: true, description });
});

// ============ Docs ============
app.get('/v1/docs', (c) => c.json({})); // Placeholder

// ============ Server Start ============

log.info("Starting LP Toolkit API Server", { port: PORT, rpc: SOLANA_RPC.slice(0,30) + '...' });
serve({ fetch: app.fetch, port: Number(PORT) });

export default app;
