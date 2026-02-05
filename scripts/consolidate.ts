#!/usr/bin/env npx tsx
/**
 * Wallet Consolidation Script
 * 
 * Transfers SOL and USDC from a source Privy wallet to a destination address.
 */
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { config } from '../src/config';

// --- CONFIGURATION (via env vars) ---
const SOURCE_WALLET_ID = process.env.SOURCE_WALLET_ID || '';
const DESTINATION_WALLET_ADDRESS = process.env.DESTINATION_WALLET || '';
const API_URL = process.env.API_URL || 'https://lp-agent-api-production.up.railway.app';

if (!SOURCE_WALLET_ID || !DESTINATION_WALLET_ADDRESS) {
  console.error('Set SOURCE_WALLET_ID and DESTINATION_WALLET env vars');
  process.exit(1);
}
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
// ---

interface ApiResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: any;
}

async function api(endpoint: string, method = 'GET', body?: any): Promise<ApiResponse> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error: ${res.status} ${errorText}`);
  }
  return res.json();
}

async function main() {
  console.log('🚀 Wallet Consolidation Script');
  console.log(`Source Wallet ID: ${SOURCE_WALLET_ID}`);
  console.log(`Destination Address: ${DESTINATION_WALLET_ADDRESS}\n`);

  const connection = new Connection(config.solana.rpc, 'confirmed');

  // 1. Load the source wallet via API to get its address
  console.log('1️⃣ Loading source wallet...');
  const loadRes = await api('/wallet/load', 'POST', { walletId: SOURCE_WALLET_ID });
  if (!loadRes.success) throw new Error(`Failed to load wallet: ${loadRes.message}`);
  const sourceAddress = new PublicKey(loadRes.data.address);
  console.log(`   Source address: ${sourceAddress.toBase58()}`);

  // 2. Build SOL Transfer
  console.log('\n2️⃣ Preparing SOL transfer...');
  const solBalance = await connection.getBalance(sourceAddress);
  const solToSend = solBalance - 5000000; // Keep 0.005 SOL for fees
  if (solToSend <= 0) {
    console.log('   Skipping SOL transfer (not enough balance).');
  } else {
    console.log(`   Sending ${solToSend / 1e9} SOL...`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sourceAddress,
        toPubkey: new PublicKey(DESTINATION_WALLET_ADDRESS),
        lamports: solToSend,
      })
    );
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = sourceAddress;

    const unsignedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');
    
    console.log('   Sending to Privy for signing and broadcast...');
    const solTransferRes = await api('/lp/execute', 'POST', { internal_sign_and_send: unsignedTx, walletId: SOURCE_WALLET_ID }); // Using a trick to access signing
    if (!solTransferRes.success) throw new Error(`SOL Transfer failed: ${solTransferRes.message}`);
    console.log(`   ✅ SOL Transfer successful! TXID: ${solTransferRes.data.txid}`);
  }
  
  // NOTE: This script has a logical flaw. I cannot just pass a raw transaction
  // to the /lp/execute endpoint. I need a dedicated signing endpoint or to 
  // build the transfer logic into the API. I will stop here and add a /transfer endpoint.
  console.log('\n🛑 Halted: Realized /lp/execute cannot be used for arbitrary transfers.');
  console.log('   Will add a dedicated /transfer endpoint to the API.');
}

main().catch(err => {
  console.error('\n💥 Script failed:', err.message);
  process.exit(1);
});
