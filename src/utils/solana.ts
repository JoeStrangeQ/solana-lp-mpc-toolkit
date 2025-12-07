import { zAddress } from "../../convex/utils/solana";

export function abbreviateAddress(address: string, size = 4): string {
  const parsedAddress = zAddress.parse(address);
  return `${parsedAddress.slice(0, size)}…${parsedAddress.slice(-size)}`;
}

export function abbreviateTxId(txId: string, size = 4): string {
  return `${txId.slice(0, size)}…${txId.slice(-size)}`;
}
