/**
 * Wallet Service - Shared wallet operations for routes and bot
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config/index.js';
import { withRetry, isTransientError } from '../utils/resilience.js';

// Lazy-load Privy to avoid ESM/CJS issues at startup
let PrivyWalletClient: any = null;
async function loadPrivy() {
  if (!PrivyWalletClient) {
    try {
      const module = await import('../mpc/privyClient.js');
      PrivyWalletClient = module.PrivyWalletClient;
    } catch (e) {
      console.warn('Privy SDK failed to load (ESM issue):', (e as Error).message);
    }
  }
  return PrivyWalletClient;
}

export async function createPrivyClient() {
  if (!config.privy?.appId || !config.privy?.appSecret) {
    return null;
  }

  const Client = await loadPrivy();
  if (!Client) return null;

  try {
    return new Client({
      appId: config.privy.appId,
      appSecret: config.privy.appSecret,
      authorizationPrivateKey: config.privy.authorizationPrivateKey || undefined,
    });
  } catch (e) {
    console.warn('Privy client creation failed:', (e as Error).message);
    return null;
  }
}

export async function loadWalletById(walletId: string): Promise<{ client: any; wallet: any }> {
  const client = await createPrivyClient();
  if (!client) {
    throw new Error('Privy not configured');
  }
  const wallet = await withRetry(
    () => client.loadWallet(walletId) as Promise<any>,
    { maxRetries: 2, baseDelayMs: 1000, retryOn: isTransientError },
  );
  return { client, wallet };
}

export function getConnection(): Connection {
  return new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
}

export async function getWalletBalance(walletAddress: string): Promise<{ lamports: number; sol: number }> {
  const connection = getConnection();
  const balance = await withRetry(
    () => connection.getBalance(new PublicKey(walletAddress)),
    { maxRetries: 2, baseDelayMs: 500, retryOn: isTransientError },
  );
  return {
    lamports: balance,
    sol: balance / LAMPORTS_PER_SOL,
  };
}
