export function formatCurrency(amount: number, symbol = "$", decimals = 2): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const sign = safe < 0 ? "-" : "";
  return `${sign}${symbol}${Math.abs(safe).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
