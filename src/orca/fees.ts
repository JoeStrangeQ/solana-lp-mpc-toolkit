/**
 * Orca Whirlpool fee harvesting
 *
 * Builds transactions to collect fees and rewards from positions.
 */

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getWhirlpoolClient, getOrcaConnection, getWhirlpoolCtx } from './client.js';
import { PDAUtil } from '@orca-so/whirlpools-sdk';

export async function buildOrcaFeeClaimTx(
  walletAddress: string,
  positionMintAddress: string,
): Promise<string[]> {
  const connection = getOrcaConnection();
  const client = getWhirlpoolClient(connection);
  const ctx = getWhirlpoolCtx(connection);

  const positionPDA = PDAUtil.getPosition(
    ctx.program.programId,
    new PublicKey(positionMintAddress),
  );
  const position = await client.getPosition(positionPDA.publicKey);

  const unsignedTransactions: string[] = [];

  // Collect fees (with updateFeesAndRewards = true to refresh on-chain state)
  const feesTxBuilder = await position.collectFees(
    true,          // updateFeesAndRewards
    undefined,     // ownerTokenAccountMap
    walletAddress, // destinationWallet
    walletAddress, // positionWallet
    walletAddress, // ataPayer
  );

  const feesPayload = await feesTxBuilder.build();
  const feesTx = feesPayload.transaction;
  if (feesPayload.signers.length > 0) {
    if (feesTx instanceof VersionedTransaction) {
      feesTx.sign(feesPayload.signers);
    } else {
      feesTx.partialSign(...feesPayload.signers);
    }
  }

  if (feesTx instanceof VersionedTransaction) {
    unsignedTransactions.push(Buffer.from(feesTx.serialize()).toString('base64'));
  } else {
    feesTx.feePayer = new PublicKey(walletAddress);
    const serialized = feesTx.serialize({ requireAllSignatures: false });
    unsignedTransactions.push(serialized.toString('base64'));
  }

  // Collect rewards
  const rewardTxBuilders = await position.collectRewards(
    undefined,     // rewardsToCollect (all)
    false,         // updateFeesAndRewards (already updated above)
    undefined,     // ownerTokenAccountMap
    walletAddress, // destinationWallet
    walletAddress, // positionWallet
    walletAddress, // ataPayer
  );

  for (const txBuilder of rewardTxBuilders) {
    if (txBuilder.isEmpty()) continue;
    const payload = await txBuilder.build();
    const tx = payload.transaction;
    if (payload.signers.length > 0) {
      if (tx instanceof VersionedTransaction) {
        tx.sign(payload.signers);
      } else {
        tx.partialSign(...payload.signers);
      }
    }

    if (tx instanceof VersionedTransaction) {
      unsignedTransactions.push(Buffer.from(tx.serialize()).toString('base64'));
    } else {
      tx.feePayer = new PublicKey(walletAddress);
      const serialized = tx.serialize({ requireAllSignatures: false });
      unsignedTransactions.push(serialized.toString('base64'));
    }
  }

  return unsignedTransactions;
}
