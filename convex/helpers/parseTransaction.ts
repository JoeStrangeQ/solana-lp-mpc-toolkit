import { connection } from "../convexEnv";
import { fastTransactionConfirm, mints } from "../utils/solana";
import BN from "bn.js";

type TokenAmountRes = {
  rawAmount: BN;
  decimals: number;
};

type ParseTxFailResult = {
  ok: false;
  failedSigs: string[];
  confirmedSigs?: string[];
};

type ParseTxSuccessResult = {
  ok: true;
  parsedTransactions: any[];
  preTokenBalances: Record<string, TokenAmountRes>;
  postTokenBalances: Record<string, TokenAmountRes>;
  tokenBalancesChange: Record<string, TokenAmountRes>;
};

export type ParseTxResult = ParseTxFailResult | ParseTxSuccessResult;

export async function parseTransactionsBalanceChanges({
  userAddress,
  signatures,
  shouldAwaitConfirmation,
}: {
  userAddress: string;
  signatures: string[];
  shouldAwaitConfirmation?: boolean;
}): Promise<ParseTxResult> {
  if (shouldAwaitConfirmation) {
    const statuses = await fastTransactionConfirm(signatures);
    const failedSigs = statuses.filter((s) => s.status === "failed").map((s) => s.signature);
    const confirmedSigs = statuses.filter((s) => s.status === "confirmed").map((s) => s.signature);

    if (failedSigs.length > 0) {
      return {
        ok: false,
        failedSigs: failedSigs,
        confirmedSigs,
      };
    }
  }
  const parsedTransactions = await Promise.all(
    signatures.map((sig) =>
      connection.getParsedTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      })
    )
  );

  const preTokenBalances: Record<string, TokenAmountRes> = {};
  const postTokenBalances: Record<string, TokenAmountRes> = {};
  const tokenBalancesChange: Record<string, TokenAmountRes> = {};

  for (const tx of parsedTransactions) {
    if (!tx || !tx.meta) continue;

    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];

    // -----------------------------------------
    // PRE TOKEN BALANCES
    // -----------------------------------------
    for (const b of pre) {
      if (b.owner !== userAddress) continue;

      preTokenBalances[b.mint] = {
        rawAmount: new BN(b.uiTokenAmount.amount),
        decimals: b.uiTokenAmount.decimals,
      };
    }

    // -----------------------------------------
    // POST TOKEN BALANCES
    // -----------------------------------------
    for (const b of post) {
      if (b.owner !== userAddress) continue;

      postTokenBalances[b.mint] = {
        rawAmount: new BN(b.uiTokenAmount.amount),
        decimals: b.uiTokenAmount.decimals,
      };

      const mint = b.mint;
      const postBN = new BN(b.uiTokenAmount.amount);
      const preBN = new BN(preTokenBalances[mint]?.rawAmount ?? 0);

      const diff = postBN.sub(preBN);

      tokenBalancesChange[mint] = {
        rawAmount: diff,
        decimals: b.uiTokenAmount.decimals,
      };
    }

    // -----------------------------------------
    // SOL BALANCE CHANGE
    // -----------------------------------------
    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());

    const userIndex = accountKeys.indexOf(userAddress);
    if (userIndex === -1) throw new Error("Couldn't find user index");

    const preSol = new BN(tx.meta.preBalances[userIndex]);
    const postSol = new BN(tx.meta.postBalances[userIndex]);
    const solDelta = postSol.sub(preSol);

    if (!solDelta.isZero()) {
      tokenBalancesChange[mints.sol] = {
        rawAmount: solDelta,
        decimals: 9,
      };
    }
  }

  return {
    ok: true,
    parsedTransactions,
    preTokenBalances,
    postTokenBalances,
    tokenBalancesChange,
  };
}
