/**
 * Format utilities for MnM Lending Protocol
 */

/**
 * Format a number with the given decimals to a human-readable string
 */
export function formatUnits(
  value: number | bigint,
  decimals: number = 6,
): string {
  const num = typeof value === "bigint" ? Number(value) : value;
  const divisor = Math.pow(10, decimals);
  const formatted = (num / divisor).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatted;
}

/**
 * Parse a string amount to the smallest unit (e.g., USDC to micro-USDC)
 */
export function parseUnits(value: string, decimals: number = 6): bigint {
  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFraction);
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return value.toFixed(decimals) + "%";
}

/**
 * Shorten a Solana address for display
 */
export function shortenAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format a timestamp to a readable date
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
