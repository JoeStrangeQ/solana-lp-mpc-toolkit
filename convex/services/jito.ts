import z from "zod";
import { JITO_UUID, RPC_URL } from "../convexEnv";

const JITO_URL = "https://mainnet.block-engine.jito.wtf";
const CACHE_TTL_MS = 35_000;
let cachedTip: { data: JitoTipInfo; ts: number } | null = null;

const JitoBundleResponseZ = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: z.string(), // bundle_id
});

export const JitoTipInfoZ = z.object({
  time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/, "Invalid ISO timestamp"),
  landed_tips_25th_percentile: z.number(),
  landed_tips_50th_percentile: z.number(),
  landed_tips_75th_percentile: z.number(),
  landed_tips_95th_percentile: z.number(),
  landed_tips_99th_percentile: z.number(),
  ema_landed_tips_50th_percentile: z.number(),
});

const SimulatedTxResultZ = z.object({
  err: z.any().nullable(),
  logs: z.array(z.string()).optional(),
  preExecutionAccounts: z.any().optional().nullable(),
  postExecutionAccounts: z.any().optional().nullable(),
  returnData: z
    .object({
      programId: z.string(),
      data: z.string(),
    })
    .nullable()
    .optional(),
  unitsConsumed: z.number().optional(),
});

const SimulateBundleSuccessZ = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number().or(z.string()).optional(),
  result: z.object({
    context: z
      .object({
        apiVersion: z.string().optional(),
        slot: z.number().optional(),
      })
      .optional(),
    value: z.object({
      summary: z.string(),
      transactionResults: z.array(SimulatedTxResultZ),
    }),
  }),
});

// ---- Error response ----
const SimulateBundleErrorZ = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number().or(z.string()).optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }),
});

// ---- Union the two ----
export const SimulateBundleResponseZ = z.union([SimulateBundleSuccessZ, SimulateBundleErrorZ]);

const JitoBundleStatusZ = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.object({
    context: z.object({
      slot: z.number(),
    }),
    value: z
      .array(
        z.object({
          bundle_id: z.string(),
          transactions: z.array(z.string()).nonempty(),
          slot: z.number(),
          confirmation_status: z.enum(["processed", "confirmed", "finalized"]),
          err: z.record(z.any()).nullable(),
        })
      )
      .nullable(),
  }),
});

const InflightBundleStatusZ = z.object({
  status: z.enum(["Pending", "Landed", "Failed", "Invalid", "Expired"]),
  landed_slot: z.number().nullable().optional(),
  bundle_id: z.string(),
});

const GetInflightBundleStatusesZ = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.object({
    value: z.array(InflightBundleStatusZ).nullable(),
  }),
});

export type JitoTipInfo = z.infer<typeof JitoTipInfoZ>;
export type SimulateBundleResponse = z.infer<typeof SimulateBundleResponseZ>;
export type JitoBundleStatus = z.infer<typeof JitoBundleStatusZ>;

export async function sendJitoBundle(txs: string[]) {
  if (txs.length > 5) {
    throw new Error("Bundle cannot contain more than 5 transactions");
  }

  // --- Send request ---
  const res = await fetch(`${JITO_URL}/api/v1/bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jito-auth": JITO_UUID },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [txs, { encoding: "base64" }],
    }),
  });

  if (!res.ok) {
    throw new Error(`sendBundle failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // --- Validate response ---
  const parsed = JitoBundleResponseZ.safeParse(json);
  if (!parsed.success) {
    console.error("Invalid Jito sendBundle response:", parsed.error.format());
    throw new Error("Jito sendBundle returned invalid schema");
  }

  return { bundleId: parsed.data.result };
}

export async function simulateBundle(txs: string[]) {
  // 🌐 Call RPC
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateBundle",
      params: [{ encodedTransactions: txs }],
    }),
  });

  if (!res.ok) {
    throw new Error(`simulateBundle failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // ✅ Validate response

  console.log("Json", JSON.stringify(json, undefined, 2));
  const parsed = SimulateBundleResponseZ.safeParse(json);
  if (!parsed.success) {
    console.error("Invalid simulateBundle response:", parsed.error.format());
    throw new Error("simulateBundle returned invalid schema");
  }

  // --- Handle Error response ---
  if ("error" in parsed.data) {
    const { code, message } = parsed.data.error;
    console.error(`❌ [simulateBundle] RPC error ${code}: ${message}`);
    throw new Error(`Simulation failed: ${message}`);
  }

  // --- Handle Success response ---
  const txResults = parsed.data.result.value.transactionResults;
  const failedTx = txResults.find((r) => r.err);
  if (failedTx) {
    throw new Error(`Simulation failed: ${failedTx.err?.message ?? JSON.stringify(failedTx.err)}`);
  }

  return parsed.data.result.value;
}

export async function getJitoTipInfo(): Promise<JitoTipInfo> {
  if (cachedTip && Date.now() - cachedTip.ts < CACHE_TTL_MS) {
    return cachedTip.data;
  }

  const res = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor", {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Jito tip info: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  console.log("pre parse", json);
  const parsed = z.array(JitoTipInfoZ).nonempty().safeParse(json);
  if (!parsed.success) {
    console.error("Invalid Jito tip API response:", parsed.error.format());
    throw new Error("Jito tip API returned invalid schema");
  }

  const latest = parsed.data[0];

  cachedTip = { data: latest, ts: Date.now() };

  return latest;
}

export async function getJitoBundleStatus(bundleId: string) {
  const res = await fetch(`${JITO_URL}/api/v1/getBundleStatuses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jito-auth": JITO_UUID },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBundleStatuses",
      params: [[bundleId]],
    }),
  });

  if (!res.ok) {
    throw new Error(`getBundleStatuses failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // --- Validate response ---
  console.log("Pre parsed", json);
  const parsed = JitoBundleStatusZ.safeParse(json);
  if (!parsed.success) {
    console.error("Invalid Jito bundle status response:", parsed.error);
    throw new Error("Invalid response format from Jito API");
  }

  const { value } = parsed.data.result;

  // --- Handle not found ---
  if (!value || value.length === 0) {
    return {
      found: false,
      status: "not_found" as const,
    };
  }

  const bundle = value[0];

  // --- Handle error ---
  if (bundle.err && "Err" in bundle.err) {
    throw new Error(`Jito bundle error: ${bundle.err.Err}`);
  }

  return {
    found: true,
    slot: bundle.slot,
    confirmationStatus: bundle.confirmation_status,
    txs: bundle.transactions,
  };
}

export async function getJitoInflightBundleStatus(bundleId: string) {
  const res = await fetch(`${JITO_URL}/api/v1/getInflightBundleStatuses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jito-auth": JITO_UUID },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getInflightBundleStatuses",
      params: [[bundleId]],
    }),
  });

  if (!res.ok) throw new Error(`getInflightBundleStatuses failed: ${res.status}`);

  const json = await res.json();
  console.log("inflight", JSON.stringify(json));
  const parsed = GetInflightBundleStatusesZ.safeParse(json);
  if (!parsed.success) {
    console.error("Invalid inflight response", parsed.error);
    throw new Error("Invalid inflight bundle response");
  }

  const bundle = parsed.data.result.value?.[0];
  if (!bundle) return { status: "not_found" as const };

  return bundle;
}
