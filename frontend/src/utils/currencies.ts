export interface Currency {
  code: string;
  symbol: string;
  name: string;
}

export const CURRENCIES: Currency[] = [
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "\u20AC", name: "Euro" },
  { code: "GBP", symbol: "\u00A3", name: "British Pound" },
  { code: "NGN", symbol: "\u20A6", name: "Nigerian Naira" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "GHS", symbol: "GH\u20B5", name: "Ghanaian Cedi" },
  { code: "RWF", symbol: "FRw", name: "Rwandan Franc" },
  { code: "ETB", symbol: "Br", name: "Ethiopian Birr" },
  { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling" },
  { code: "UGX", symbol: "USh", name: "Ugandan Shilling" },
  { code: "INR", symbol: "\u20B9", name: "Indian Rupee" },
  { code: "JPY", symbol: "\u00A5", name: "Japanese Yen" },
  { code: "CNY", symbol: "\u00A5", name: "Chinese Yuan" },
  { code: "AED", symbol: "\u062F.\u0625", name: "UAE Dirham" },
  { code: "SAR", symbol: "\uFDFC", name: "Saudi Riyal" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
];

export function symbolFor(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? "$";
}
