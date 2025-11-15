export function amountToRawAmount(amount: number, decimals: number) {
  return amount * 10 ** decimals;
}

export function rawAmountToAmount(rawAmount: number, decimals: number) {
  return rawAmount / 10 ** decimals;
}
