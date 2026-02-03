/**
 * Transaction Builder Test
 * Validates that real unsigned transactions can be built
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { buildAddLiquidityTx } from '../src/api/txBuilder';
import config from '../src/api/config';

// A known Meteora DLMM pool on devnet
const DEVNET_POOL = 'Ec4r8FjQnF4uTKRr69a2p5skvdrSmc3aW5aD1p4tDonD'; // SOL-USDC

async function main() {
  console.log('🦀 Validating Transaction Builder...');
  
  const connection = new Connection(config.solana.rpcDevnet, 'confirmed');
  const testWallet = Keypair.generate();
  
  console.log(`Using devnet RPC: ${config.solana.rpcDevnet}`);
  console.log(`Test wallet: ${testWallet.publicKey.toBase58()}`);

  const params = {
    userPubkey: testWallet.publicKey.toBase58(),
    poolAddress: DEVNET_POOL,
    venue: 'meteora',
    tokenA: 'SOL',
    tokenB: 'USDC',
    amountA: 0.01,
    amountB: 1,
  };

  try {
    const result = await buildAddLiquidityTx(connection, params);
    
    if (result.success && result.transaction) {
      console.log('✅ Successfully built unsigned transaction!');
      console.log(`   Message: ${result.transaction.message}`);
      console.log(`   Instructions: ${result.instructions?.join(', ')}`);
      console.log(`   Serialized TX size: ${result.transaction.serialized.length}`);
    } else {
      console.error('❌ Failed to build transaction:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ An unexpected error occurred:', error);
    process.exit(1);
  }
}

main();
