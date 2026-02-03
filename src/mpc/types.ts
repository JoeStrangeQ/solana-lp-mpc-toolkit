/**
 * Portal MPC Wallet Types
 */

export interface MPCWallet {
  id: string;
  addresses: {
    solana: string;
    ethereum?: string;
  };
  share: string; // Encrypted key share
  createdAt: string;
}

export interface GenerateWalletResponse {
  id: string;
  addresses: {
    solana: string;
    ethereum?: string;
  };
  share: string;
}

export interface SignTransactionParams {
  share: string;
  transaction: string; // Base64 encoded unsigned TX
  chainId?: string;
}

export interface SignTransactionResponse {
  signature: string;
  signedTransaction: string; // Base64 encoded signed TX
}

export interface SendAssetParams {
  share: string;
  chain: 'solana-mainnet' | 'solana-devnet';
  token: string; // 'NATIVE' for SOL, or SPL token address
  to: string;
  amount: string;
}

export interface SendAssetResponse {
  transactionHash: string;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface WalletBalance {
  token: string;
  symbol: string;
  balance: string;
  decimals: number;
}
