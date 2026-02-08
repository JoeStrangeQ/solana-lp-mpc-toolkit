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
      
      try {
        const txHash = await signAndSendTransaction(lpResult.unsignedTransactions[i]);
        console.log(`[Orca Service] Tx ${i + 1} confirmed: ${txHash}`);
        txHashes.push(txHash);
      } catch (err: any) {
        console.error(`[Orca Service] Tx ${i + 1} failed:`, err.message);
        // If this is a signature verification error on a later tx, try refreshing blockhash
        if (i > 0 && err.message?.includes('signature verification')) {
          throw new Error(`Transaction ${i + 1} failed - position may be partially created. Check /positions.`);
        }
        throw err;
      }

      if (i < lpResult.unsignedTransactions.length - 1) {
        // Longer delay between transactions to let state settle
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    await invalidatePositionCache(walletId);
    return { lpResult, txHashes, status: 'sent' };
  }

  // Jito bundle path
  console.log(`[Orca Service] Jito bundle path: ${lpResult.unsignedTransactions.length} transactions`);
  const signedTxs: string[] = [];
  for (let i = 0; i < lpResult.unsignedTransactions.length; i++) {
    const unsignedTx = lpResult.unsignedTransactions[i];
    console.log(`[Orca Service] Signing tx ${i + 1}/${lpResult.unsignedTransactions.length}...`);
    console.log(`[Orca Service] Unsigned tx length: ${unsignedTx.length}`);
    const signedTx = await signTransaction(unsignedTx);
    console.log(`[Orca Service] Signed tx length: ${signedTx?.length || 0}`);
    if (!signedTx) {
      throw new Error(`signTransaction returned null/undefined for tx ${i + 1}`);
    }
    signedTxs.push(signedTx);
  }

  console.log(`[Orca Service] Sending bundle with ${signedTxs.length} transactions...`);
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
