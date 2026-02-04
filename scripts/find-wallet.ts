import { PrivyClient } from '@privy-io/node';
import { config } from '../src/config';

const TARGET_ADDRESS = 'Ab6Cuvz9rZUSb4uVbBGR6vm12LeuVBE5dzKsnYUtAEi4';

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
