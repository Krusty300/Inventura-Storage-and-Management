/** Payment method + mobile-money provider options and display labels.
 * Mirrors backend/app/constants.py (PAYMENT_METHODS, MOBILE_MONEY_PROVIDERS).
 */

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "transfer", label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
];

export const MOBILE_MONEY_PROVIDERS = [
  { value: "m-pesa", label: "M-Pesa" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "t-kash", label: "T-Kash" },
];

export function paymentLabel(method: string, provider?: string | null): string {
  const base = PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
  if (method === "mobile_money" && provider) {
    const p = MOBILE_MONEY_PROVIDERS.find((x) => x.value === provider);
    return `${base} (${p?.label ?? provider})`;
  }
  return base;
}
