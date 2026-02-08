/**
 * Orca Whirlpool SDK client setup
 *
 * Uses a read-only wallet for SDK context - actual signing happens via Privy MPC.
 */

import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  type WhirlpoolClient,
} from '@orca-so/whirlpools-sdk';
import { config } from '../config/index.js';

// Read-only wallet for SDK context (signing happens via Privy)
const DUMMY_WALLET = new Wallet(Keypair.generate());

export function getOrcaConnection(): Connection {
  return new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
}

export function getWhirlpoolCtx(connection?: Connection): WhirlpoolContext {
  const conn = connection || getOrcaConnection();
  const provider = new AnchorProvider(conn, DUMMY_WALLET, { commitment: 'finalized' });
  
  // CRITICAL: Use 'ata' method for wrapped SOL accounts to avoid ephemeral keypairs
  // The 'keypair' method (default) creates signers we can't access with Privy MPC
  return WhirlpoolContext.withProvider(provider, undefined, undefined, {
    accountResolverOptions: {
      createWrappedSolAccountMethod: 'ata',
      allowPDAOwnerAddress: false,
    },
  });
}

export function getWhirlpoolClient(connection?: Connection): WhirlpoolClient {
  const ctx = getWhirlpoolCtx(connection);
  return buildWhirlpoolClient(ctx);
}
