import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { privy, privyAuthContext, PrivyWallet } from "../privy";
import { getJitoBundleStatus, getJitoInflightBundleStatus, getJitoTipInfo, sendJitoBundle } from "../services/jito";

const CU_LIMIT = 1_400_000;
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];
export type TipSpeed = "low" | "medium" | "fast" | "extraFast";

export async function sendAndConfirmJitoBundle({
  txs,
  userWallet,
}: {
  txs: Transaction[] | VersionedTransaction[];
  userWallet: PrivyWallet;
}) {
  const signTransactions = txs.map((tx) =>
    privy
      .wallets()
      .solana()
      .signTransaction(userWallet.id ?? "", {
        address: userWallet.address,
        authorization_context: privyAuthContext,
        transaction: tx.serialize(),
      })
      .then((r) => r.signed_transaction)
  );

  const bundleBase64Txs = await Promise.all(signTransactions);
  // const sim = await simulateBundle(bundleBase64Txs)
  // const failedTxSim = sim.transactionResults.find((s) => s.err)
  // if (failedTxSim) {
  //   throw new Error(
  //     `Simulation failed: ${failedTxSim.err?.message ?? JSON.stringify(failedTxSim.err)}`,
  //   )
  // }

  const { bundleId } = await sendJitoBundle(bundleBase64Txs);
  const finalStatus = await confirmInflightBundle({ bundleId });

  if (!finalStatus?.found) {
    throw new Error(`Bundle ${bundleId} not found after submission.`);
  }
  if (!finalStatus.txs?.length) {
    throw new Error(`Bundle ${bundleId} landed but no txs returned.`);
  }

  return finalStatus.txs;
}

export async function confirmInflightBundle({
  bundleId,
  timeoutMs = 25_000,
  intervalMs = 750,
}: {
  bundleId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const inflight = await getJitoInflightBundleStatus(bundleId);

    if (inflight.status === "not_found") {
      console.log(`Bundle ${bundleId} not found in inflight list yet...`);
    } else if (inflight.status === "Pending") {
      console.log(`⏳ Bundle ${bundleId} still pending...`);
    } else if (inflight.status === "Failed") {
      throw new Error(`❌ Bundle ${bundleId} failed before landing`);
    } else if (inflight.status === "Landed") {
      console.log(`✅ Bundle ${bundleId} landed in slot ${inflight.landed_slot}`);
      // 🔁 Once landed, confirm finalized
      const finalStatus = await getJitoBundleStatus(bundleId);
      return finalStatus;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timeout: Bundle ${bundleId} did not land within ${timeoutMs / 1000}s`);
}

export async function buildTipTx({
  payerAddress,
  recentBlockhash,
  speed,
}: {
  payerAddress: string;
  recentBlockhash: string;
  speed: TipSpeed;
}) {
  const tipInLamp = await getTipLamportsForSpeed(speed);
  const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Date.now() % JITO_TIP_ACCOUNTS.length]);
  const payer = new PublicKey(payerAddress);

  const ix = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: tipInLamp,
  });

  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: [ix],
  }).compileToV0Message();

  const { cuLimit, cuPriceMicroLamports } = cuPriceFromTip(tipInLamp);
  return {
    tipInLamp,
    cuLimit,
    cuPriceMicroLamports,
    tipTx: new VersionedTransaction(msg),
  };
}

export async function getTipLamportsForSpeed(speed: TipSpeed): Promise<number> {
  const jitoTipInformation = await getJitoTipInfo();

  const toLamports = (sol: number) => Math.max(Math.floor(sol * LAMPORTS_PER_SOL), 5_000);

  // --- Map percentile to execution speed ---
  switch (speed) {
    case "low":
      // ~25th percentile *0.5 (slow, minimal cost)
      return toLamports(jitoTipInformation.landed_tips_25th_percentile * 0.5);

    case "medium":
      // EMA of 50th percentile (balanced)
      return toLamports(jitoTipInformation.ema_landed_tips_50th_percentile);

    case "fast":
      // 75th percentile *1.5 (usually lands next block)
      return toLamports(jitoTipInformation.landed_tips_75th_percentile * 1.5);

    case "extraFast":
      // 95th percentile *2 (aggressive, near top of auction)
      return toLamports(jitoTipInformation.landed_tips_99th_percentile * 1.5);

    default:
      return toLamports(jitoTipInformation.ema_landed_tips_50th_percentile);
  }
}

function cuPriceFromTip(tipLamports: number, cuUnits = CU_LIMIT) {
  const cuRatio = 0.3;
  const cuFeeLamports = (cuRatio / (1 - cuRatio)) * tipLamports;
  return {
    cuLimit: cuUnits,
    cuPriceMicroLamports: Math.max(1, Math.round((cuFeeLamports * 1_000_000) / cuUnits)),
  };
}
