import { PrivyClient } from '@privy-io/node';
import { config } from '../src/config';

const TARGET_ADDRESS = process.env.TARGET_ADDRESS || '';

if (!TARGET_ADDRESS) {
  console.error('Set TARGET_ADDRESS env var');
  process.exit(1);
}

async function main() {
  console.log('App ID:', config.privy.appId?.substring(0, 10) + '...');
  
  const client = new PrivyClient({
    appId: config.privy.appId,
    appSecret: config.privy.appSecret,
  });

  console.log('Searching for wallet:', TARGET_ADDRESS);
  
  // Try accessing internal API
  const internalClient = (client as any).privyApiClient;
  
  // List wallets using internal API
  const wallets = await internalClient.wallets.list({ limit: 100 });
  console.log('Found wallets:', wallets);
  
  for (const wallet of wallets.data || wallets || []) {
    console.log(`  ${wallet.address} → ${wallet.id}`);
    if (wallet.address === TARGET_ADDRESS) {
      console.log('\n✅ TARGET FOUND!');
      console.log('walletId:', wallet.id);
    }
  }
}

main().catch(console.error);
