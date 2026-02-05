/**
 * LP Agent API Server
 *
 * REST API for AI agents to manage LP positions across Solana DEXs
 * with Arcium privacy and self-custody (agents sign their own transactions)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection, PublicKey, SystemProgram, Transaction, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

import { config } from '../config/index.js';
import { GatewayClient } from '../gateway/index.js';
import { MPCClient } from '../mpc/index.js';
import { MockMPCClient } from '../mpc/mockClient.js';
import { PrivyWalletClient } from '../mpc/privyClient.js';
import { LocalKeypairClient } from '../mpc/localKeypair.js';
import { arciumPrivacy } from '../privacy/index.js';
import { parseIntent, describeIntent } from './intent.js';
import { createFeeBreakdown, FEE_CONFIG } from '../fees/index.js';
import type { AgentResponse, LPIntent, PoolOpportunity } from './types.js';
import { unsignedApi } from './unsigned.js';

// Static imports for LP and Swap modules
import { lpPipeline as lpPipelineImport, METEORA_POOLS as meteoraPoolsImport } from '../lp/index.js';
import { jupiterClient as jupiterClientImport, TOKENS as tokensImport } from '../swap/index.js';

// Module references
let jupiterClient: any = jupiterClientImport || null;
let lpPipeline: any = lpPipelineImport || null;

// Hono App
const app = new Hono();
app.use('*', cors());
app.route('/v2', unsignedApi);

// State
let mpcClient: MPCClient | MockMPCClient | null = null;
let privyClient: PrivyWalletClient | null = null;
let localKeypairClient: LocalKeypairClient | null = null;
let gatewayClient: GatewayClient | null = null;
let connection: Connection;

function getWalletClient() {
  if (localKeypairClient) return localKeypairClient;
  if (privyClient?.isWalletLoaded()) return privyClient;
  if (mpcClient?.isWalletLoaded()) return mpcClient;
  return null;
}

// Routes...
app.get('/', (c) => c.json({ name: 'LP Agent Toolkit' /* ... */ }));
app.get('/health', (c) => c.json({ status: 'ok' }));
// ... other non-wallet endpoints

app.post('/wallet/create', async (c) => {
  // ... existing create logic
});

app.post('/wallet/load', async (c) => {
  // ... existing load logic
});

app.post('/wallet/transfer', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json({ success: false, message: 'No wallet loaded' }, 400);
  }

  try {
    const { to, amount, mint } = await c.req.json();
    if (!to || !amount) {
      return c.json({ success: false, message: 'Missing `to`, `amount`' }, 400);
    }
    
    const sourceAddress = new PublicKey(walletClient.getAddress());
    const destAddress = new PublicKey(to);
    
    let tx = new Transaction();
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = sourceAddress;

    if (mint && mint.toLowerCase() !== 'sol') {
      const mintPubkey = new PublicKey(mint);
      const sourceAta = await getAssociatedTokenAddress(mintPubkey, sourceAddress);
      const destAta = await getAssociatedTokenAddress(mintPubkey, destAddress);
      const tokenInfo = await connection.getParsedAccountInfo(mintPubkey);
      const decimals = (tokenInfo.value?.data as any)?.parsed.info.decimals || 0;
      
      tx.add(
        createTransferInstruction(sourceAta, destAta, sourceAddress, Math.floor(amount * Math.pow(10, decimals)))
      );
    } else {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: sourceAddress,
          toPubkey: destAddress,
          lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        })
      );
    }
    
    const unsignedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');
    
    if (!('signAndSendTransaction' in walletClient)) {
        throw new Error('Wallet client does not support signAndSendTransaction');
    }
    
    const txid = await (walletClient as any).signAndSendTransaction(unsignedTx);

    return c.json({ success: true, message: `Transfer successful!`, data: { txid } });

  } catch (error) {
    return c.json({ success: false, message: 'Transfer failed', error: error instanceof Error ? error.message : 'Unknown' }, 500);
  }
});

// ... all other endpoints from the original file

// Start Server
export async function startServer() {
  connection = new Connection(config.solana.rpc, 'confirmed');
  // ... rest of start server logic
}
