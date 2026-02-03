import BN from "bn.js";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Address, mints, toVersioned } from "../utils/solana";
import { simulateTransaction } from "../services/solana";

type TokenAmountRes = {
  rawAmount: BN;
  decimals: number;
};

export async function simulateAndGetTokensBalance({
  userAddress,
  transaction,
}: {
  userAddress: Address;
  transaction: Transaction | VersionedTransaction;
}) {
  const versionedTx = toVersioned(transaction);
  const sim = await simulateTransaction(transaction);

  if (sim.err) {
    console.error("Simulation logs:", sim.logs);
    throw new Error("Simulation failed: " + JSON.stringify(sim.err));
  }

  const tokenBalancesChange: Record<string, TokenAmountRes> = {};
  const preTokenBalances: Record<string, TokenAmountRes> = {};
  const postTokenBalances: Record<string, TokenAmountRes> = {};

  //
  // PRE TOKEN BALANCES
  //
  for (const b of sim.preTokenBalances) {
    if (b.owner === userAddress) {
      preTokenBalances[b.mint] = {
        rawAmount: new BN(b.uiTokenAmount.amount),
        decimals: b.uiTokenAmount.decimals,
      };
    }
  }

  //
  // POST TOKEN BALANCES & DIFF
  //
  for (const post of sim.postTokenBalances) {
    if (post.owner !== userAddress) continue;

    const mint = post.mint;
    const postAmountBN = new BN(post.uiTokenAmount.amount);

    postTokenBalances[mint] = {
      rawAmount: postAmountBN,
      decimals: post.uiTokenAmount.decimals,
    };

    const pre =
      preTokenBalances[mint] ??
      ({
        rawAmount: new BN(0),
        decimals: post.uiTokenAmount.decimals,
      } satisfies TokenAmountRes);

    const diff = postAmountBN.sub(pre.rawAmount);

    tokenBalancesChange[mint] = {
      rawAmount: diff,
      decimals: post.uiTokenAmount.decimals,
    };
  }

  //
  // SOL CHANGES – use sim.preBalances/postBalances (lamports)
  //
  const accountKeys = versionedTx.message.staticAccountKeys.map((k) =>
    k.toBase58(),
  );
  const userIndex = accountKeys.indexOf(userAddress);
  if (userIndex === -1) throw new Error("Couldn't find user index");

  const solPre = new BN(sim.preBalances[userIndex]);
  const solPost = new BN(sim.postBalances[userIndex]);
  const solDelta = solPost.sub(solPre);

  if (!solDelta.isZero()) {
    tokenBalancesChange[mints.sol] = {
      rawAmount: solDelta,
      decimals: 9,
    };
  }

  return {
    sim,
    preTokenBalances,
    postTokenBalances,
    tokenBalancesChange,
  };
}
