export function formatCurrency(amount: number, symbol = "$", decimals = 2): string {
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
