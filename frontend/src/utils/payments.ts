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

export function providerLabel(provider?: string | null): string {
  if (!provider) return "";
  return MOBILE_MONEY_PROVIDERS.find((x) => x.value === provider)?.label ?? provider;
}

export function paymentBadge(method: string, provider?: string | null): { label: string; cls: string } {
  switch (method) {
    case "cash":
      return { label: "Cash", cls: "badge-success" };
    case "card":
      return { label: "Card", cls: "badge-info" };
    case "transfer":
      return { label: "Bank Transfer", cls: "badge-neutral" };
    case "mobile_money": {
      const p = MOBILE_MONEY_PROVIDERS.find((x) => x.value === provider);
      const label = p ? `Mobile Money · ${p.label}` : "Mobile Money";
      const cls = provider === "m-pesa"
        ? "badge-success"
        : provider === "airtel_money"
          ? "badge-warning"
          : provider === "t-kash"
            ? "badge-info"
            : "badge-neutral";
      return { label, cls };
    }
    default:
      return { label: method, cls: "badge-neutral" };
  }
}
