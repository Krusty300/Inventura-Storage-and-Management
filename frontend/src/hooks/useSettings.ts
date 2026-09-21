import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Settings } from "../types";

// Portal roles (supplier / customer) have no `settings.view` permission; the
// staff /api/settings endpoint 403s for them. Their settings are served by the
// scoped /portal/me and /customer/me endpoints instead, which we map onto the
// Settings shape so shared hooks (usePageSize, useDateFormat) keep working.
function portalRole(): "supplier" | "customer" | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const u = JSON.parse(raw) as { role?: unknown };
    if (u.role === "supplier" || u.role === "customer") return u.role;
    return null;
  } catch {
    return null;
  }
}

async function portalSettings(role: "supplier" | "customer"): Promise<Settings> {
  const { data } = await api.get(role === "supplier" ? "/portal/me" : "/customer/me");
  return {
    id: 0,
    store_name: data.store_name ?? "My Store",
    address: "",
    phone: "",
    email: "",
    currency_symbol: data.currency_symbol ?? "$",
    currency_code: data.currency_code ?? "USD",
    tax_rate: typeof data.tax_rate === "number" ? data.tax_rate : 0,
    default_reorder_level: 0,
    expiry_warning_days: 0,
    low_stock_alerts: false,
    expiry_alerts: false,
    shipment_prefix: "",
    work_order_prefix: "",
    invoice_prefix: "",
    po_prefix: "",
    receipt_prefix: "",
    asn_prefix: "",
    qc_prefix: "",
    cc_prefix: "",
    return_prefix: "",
    transfer_prefix: "",
    unallocated_prefix: "",
    quarantine_prefix: "",
    lpn_prefix: "",
    lpn_move_prefix: "",
    lpn_load_prefix: "",
    lpn_unload_prefix: "",
    stock_in_prefix: "",
    stock_out_prefix: "",
    adjustment_prefix: "",
    require_qc_before_ship: false,
    auto_allocate_stock: false,
    enforce_fefo: false,
    default_costing_method: "",
    fiscal_year_start_month: 1,
    default_items_per_page: data.default_items_per_page ?? 25,
    date_format: data.date_format ?? "YYYY-MM-DD",
    show_product_hover_cards: false,
    show_customer_hover_cards: false,
    show_supplier_hover_cards: false,
    show_datetime_hover_cards: false,
    show_cart_summary_hover_cards: false,
    logo_url: data.logo_url ?? "",
    tax_id: "",
    payment_terms: "",
    bank_details: "",
    footer_note: "",
  };
}

export function useSettings() {
  const authed = Boolean(localStorage.getItem("token"));
  const role = authed ? portalRole() : null;
  return useQuery<Settings>({
    queryKey: ["settings", authed ? (role ?? "auth") : "public"],
    queryFn: async () => {
      if (!authed) return (await api.get("/settings/public")).data as Settings;
      if (role) return portalSettings(role);
      return (await api.get("/settings")).data as Settings;
    },
    staleTime: 0,
  });
}