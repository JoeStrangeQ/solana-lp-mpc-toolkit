import { Address, zAddress } from "../../convex/utils/solana";

type LocalTokenMetadata = {
  name: string;
  symbol: string;
  decimals: number;
  address: Address;
  icon: string | null;
};

export const TOKENS_METADATA: Record<string, LocalTokenMetadata> = {
  SOL: {
    name: "Solana",
    symbol: "SOL",
    decimals: 9,
    address: "So11111111111111111111111111111111111111112" as Address,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  },
  USDC: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  },
};

export function abbreviateAddress(address: string, size = 4): string {
  const parsedAddress = zAddress.parse(address);
  return `${parsedAddress.slice(0, size)}…${parsedAddress.slice(-size)}`;
}

export function abbreviateTxId(txId: string, size = 4): string {
  return `${txId.slice(0, size)}…${txId.slice(-size)}`;
}
