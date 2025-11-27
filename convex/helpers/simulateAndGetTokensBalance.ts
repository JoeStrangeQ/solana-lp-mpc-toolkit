import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Address, mints, toVersioned } from "../utils/solana";
import { simulateTransaction } from "../services/solana";

type TokenAmountRes = {
  rawAmount: bigint;
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

  for (const b of sim.preTokenBalances) {
    if (b.owner === userAddress) {
      preTokenBalances[b.mint] = {
        rawAmount: BigInt(b.uiTokenAmount.amount),
        decimals: b.uiTokenAmount.decimals,
      };
    }
  }

  for (const post of sim.postTokenBalances) {
    if (post.owner !== userAddress) continue;

    postTokenBalances[post.mint] = {
      rawAmount: BigInt(post.uiTokenAmount.amount),
      ...post.uiTokenAmount,
    };

    const mint = post.mint;

    const pre = preTokenBalances[mint];
    const postAmount = BigInt(post.uiTokenAmount.amount);

    const diff = postAmount - pre.rawAmount;

    tokenBalancesChange[mint] = {
      rawAmount: diff,
      decimals: post.uiTokenAmount.decimals,
    };
  }

  const accountKeys = versionedTx.message.staticAccountKeys.map((k) => k.toBase58());
  const userIndex = accountKeys.indexOf(userAddress);
  if (userIndex === -1) throw new Error("Couldn't find user index");

  const solDelta = BigInt(sim.postBalances[userIndex]) - BigInt(sim.preBalances[userIndex]);
  if (solDelta !== 0n) {
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
