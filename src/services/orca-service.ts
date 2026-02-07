/**
 * Orca Service - Orca Whirlpool operation orchestration for routes and bot
 */

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { buildOrcaAtomicLP, type OrcaAtomicLPParams } from '../orca/atomic.js';
import { buildOrcaWithdraw } from '../orca/atomicWithdraw.js';
import { buildOrcaFeeClaimTx } from '../orca/fees.js';
import { discoverOrcaPositions } from '../orca/positions.js';
import { sendBundle, waitForBundle, type TipSpeed } from '../jito/index.js';
import { config } from '../config/index.js';
import { withRetry, isTransientError } from '../utils/resilience.js';
import { invalidatePositionCache } from './lp-service.js';

export interface OrcaLpExecuteParams {
  walletId: string;
  walletAddress: string;
  poolAddress: string;
  amountSol: number;
  strategy: 'concentrated' | 'wide';
  tipSpeed: TipSpeed;
  slippageBps: number;
  signTransaction: (tx: string) => Promise<string>;
  signAndSendTransaction?: (tx: string) => Promise<string>;
}

export async function executeOrcaLp(params: OrcaLpExecuteParams) {
  const {
    walletId, walletAddress, poolAddress, amountSol,
    strategy, tipSpeed, slippageBps,
    signTransaction, signAndSendTransaction,
  } = params;

  const useDirectRpc = !!signAndSendTransaction;

  const lpResult = await buildOrcaAtomicLP({
    walletAddress,
    poolAddress,
    amountSol,
    strategy,
    slippageBps,
    tipSpeed,
    skipTip: useDirectRpc,
  });

  if (useDirectRpc) {
    const txHashes: string[] = [];
    for (let i = 0; i < lpResult.unsignedTransactions.length; i++) {
      console.log(`[Orca Service] Signing+sending tx ${i + 1}/${lpResult.unsignedTransactions.length}...`);
      const txHash = await signAndSendTransaction(lpResult.unsignedTransactions[i]);
      console.log(`[Orca Service] Tx ${i + 1} confirmed: ${txHash}`);
      txHashes.push(txHash);

      if (i < lpResult.unsignedTransactions.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    await invalidatePositionCache(walletId);
    return { lpResult, txHashes, status: 'sent' };
  }

  // Jito bundle path
  const signedTxs: string[] = [];
  for (const unsignedTx of lpResult.unsignedTransactions) {
    const signedTx = await signTransaction(unsignedTx);
    signedTxs.push(signedTx);
  }

  const { bundleId } = await withRetry(
    () => sendBundle(signedTxs),
    { maxRetries: 2, baseDelayMs: 2000, retryOn: isTransientError },
  );
  const status = await waitForBundle(bundleId, { timeoutMs: 60000 });

  await invalidatePositionCache(walletId);
  return { lpResult, bundleId, status };
}

export interface OrcaWithdrawExecuteParams {
  walletId: string;
  walletAddress: string;
  poolAddress: string;
  positionMintAddress: string;
  slippageBps?: number;
  signTransaction: (tx: string) => Promise<string>;
  signAndSendTransaction?: (tx: string) => Promise<string>;
}

export async function executeOrcaWithdraw(params: OrcaWithdrawExecuteParams) {
  const {
    walletId, walletAddress, poolAddress, positionMintAddress,
    slippageBps, signTransaction, signAndSendTransaction,
  } = params;

  const useDirectRpc = !!signAndSendTransaction;

  const withdrawResult = await buildOrcaWithdraw({
    walletAddress,
    poolAddress,
    positionMintAddress,
    slippageBps,
  });

  if (useDirectRpc) {
    const txHashes: string[] = [];
    for (let i = 0; i < withdrawResult.unsignedTransactions.length; i++) {
      console.log(`[Orca Service] Signing+sending withdraw tx ${i + 1}/${withdrawResult.unsignedTransactions.length}...`);
      const txHash = await signAndSendTransaction(withdrawResult.unsignedTransactions[i]);
      console.log(`[Orca Service] Withdraw tx ${i + 1} confirmed: ${txHash}`);
      txHashes.push(txHash);

      if (i < withdrawResult.unsignedTransactions.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    await invalidatePositionCache(walletId);
    return { withdrawResult, txHashes, status: 'sent' };
  }

  const signedTxs: string[] = [];
  for (const unsignedTx of withdrawResult.unsignedTransactions) {
    const signedTx = await signTransaction(unsignedTx);
    signedTxs.push(signedTx);
  }

  const { bundleId } = await withRetry(
    () => sendBundle(signedTxs),
    { maxRetries: 2, baseDelayMs: 2000, retryOn: isTransientError },
  );
  const status = await waitForBundle(bundleId, { timeoutMs: 60000 });

  await invalidatePositionCache(walletId);
  return { withdrawResult, bundleId, status };
}

export interface OrcaFeeClaimParams {
  walletId: string;
  walletAddress: string;
  positionMintAddress: string;
  signAndSendTransaction: (tx: string) => Promise<string>;
}

export async function executeOrcaFeeClaim(params: OrcaFeeClaimParams) {
  const { walletId, walletAddress, positionMintAddress, signAndSendTransaction } = params;

  const unsignedTxs = await buildOrcaFeeClaimTx(walletAddress, positionMintAddress);

  const txHashes: string[] = [];
  for (let i = 0; i < unsignedTxs.length; i++) {
    console.log(`[Orca Service] Signing+sending fee claim tx ${i + 1}/${unsignedTxs.length}...`);
    const txHash = await signAndSendTransaction(unsignedTxs[i]);
    console.log(`[Orca Service] Fee claim tx ${i + 1} confirmed: ${txHash}`);
    txHashes.push(txHash);

    if (i < unsignedTxs.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  await invalidatePositionCache(walletId);
  return { txHashes, status: 'sent' };
}

export async function getOrcaPositionsForWallet(walletAddress: string) {
  const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
  return discoverOrcaPositions(conn, walletAddress);
}
