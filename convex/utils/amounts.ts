import BN from "bn.js";

export function amountToRawAmount(amount: number, decimals: number) {
  return amount * 10 ** decimals;
}

export function rawAmountToAmount(rawAmount: number, decimals: number) {
  return rawAmount / 10 ** decimals;
}

export function amountToRawBN(amount: BN, decimals: number): BN {
  return amount.mul(new BN(10).pow(new BN(decimals)));
}

export function rawToAmountBN(raw: BN, decimals: number): BN {
  return raw.div(new BN(10).pow(new BN(decimals)));
}

export function safeBigIntToNumber(value: bigint | BN, label?: string): number {
  const big = typeof value === "bigint" ? value : BigInt(value.toString());

  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);

  if (big > max || big < min) {
    throw new Error(
      `Unsafe number conversion${label ? ` for ${label}` : ""}: bigint ${big} is outside JS safe integer range`,
    );
  }

  return Number(big);
}
