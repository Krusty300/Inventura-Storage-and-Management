import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CreditCard, Landmark, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import api from "../../api/client";
import { useCustomerCart } from "../../context/CustomerCartContext";
import { useToast } from "../../context/ToastContext";
import { entityImageUrl } from "../../utils/images";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import { formatCurrency } from "../../utils/currency";
import { errorMessage } from "../../utils/errors";
import EmptyState from "../../components/EmptyState";
import type { CustomerPortalMe, Sale } from "../../types";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: Banknote, hint: "Pay on pickup or delivery" },
  { value: "card", label: "Card", icon: CreditCard, hint: "Pay by card" },
  { value: "transfer", label: "Bank Transfer", icon: Landmark, hint: "Pay by bank transfer" },
];

export default function CustomerCart() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { items, setQuantity, remove, clear } = useCustomerCart();
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const { data: me } = useQuery({
    queryKey: ["customer", "me"],
    queryFn: async () => (await api.get("/customer/me")).data as CustomerPortalMe,
  });
  const currencySymbol = me?.currency_symbol || "$";
  const taxRate = me?.tax_rate || 0;

  const subtotal = useMemo(
    () => items.reduce((sum, it) => sum + it.product.price * it.quantity, 0),
    [items],
  );
  const tax = (subtotal * taxRate) / 100;
  const total = subtotal + tax;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        items: items.map((it) => ({ product_id: it.product.id, quantity: it.quantity })),
        payment_method: method,
      };
      if (reference.trim()) payload.payment_reference = reference.trim();
      const { data } = await api.post("/customer/checkout", payload);
      return data as Sale;
    },
    onSuccess: (sale) => {
      clear();
      queryClient.invalidateQueries({ queryKey: ["customer"] });
      addToast(`Order ${sale.invoice_number} placed`, "success");
      navigate(`/portal/invoices/${sale.id}`);
    },
  });

  if (items.length === 0 && !mutation.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ShoppingCart size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Your Cart</h1>
            <p className="text-sm text-muted mt-1">Review what you are ready to order.</p>
          </div>
        </div>
        <EmptyState
          variant="block"
          icon={<ShoppingCart size={32} />}
          title="Your cart is empty"
          message="Browse the catalog and add products to get started."
          actionLabel="Browse catalog"
          onAction={() => navigate("/portal/catalog")}
        />
      </div>
    );
  }

  const canSubmit = items.length > 0 && !mutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ShoppingCart size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Your Cart</h1>
            <p className="text-sm text-muted mt-1 truncate">Review what you are ready to order.</p>
          </div>
        </div>
        <Link to="/portal/catalog" className="btn-secondary text-sm shrink-0">Continue shopping</Link>
      </div>

      {mutation.isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(mutation.error, "Checkout failed")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          {items.map((it) => (
            <div key={it.product.id} className="card p-4 flex flex-col sm:flex-row gap-4">
              <div className="h-20 w-20 shrink-0 rounded-lg bg-subtle-strong overflow-hidden self-center sm:self-start">
                <img
                  src={it.product.image_url ? entityImageUrl(it.product.image_url) : getPlaceholder()}
                  alt={it.product.name}
                  onError={onImageError}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-faint uppercase tracking-wide">{it.product.category_name || "Uncategorized"}</p>
                <h3 className="font-semibold text-ink leading-snug">{it.product.name}</h3>
                {it.product.sku && <p className="text-xs text-faint">SKU: {it.product.sku}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm font-bold text-ink">{formatCurrency(it.product.price * it.quantity, currencySymbol)}</span>
                  <span className="text-xs text-faint">{formatCurrency(it.product.price, currencySymbol)} each</span>
                </div>
              </div>
              <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setQuantity(it.product.id, it.quantity - 1)}
                    className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:bg-subtle"
                    aria-label={`Decrease quantity of ${it.product.name}`}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-10 text-center text-sm font-medium text-ink" aria-label="Quantity">{it.quantity}</span>
                  <button
                    onClick={() => setQuantity(it.product.id, it.quantity + 1)}
                    className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:bg-subtle"
                    aria-label={`Increase quantity of ${it.product.name}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <button
                  onClick={() => remove(it.product.id)}
                  className="p-1.5 rounded-lg text-faint hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                  aria-label={`Remove ${it.product.name} from cart`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card p-5 space-y-4 lg:sticky lg:top-[5.25rem]">
          <h2 className="font-bold text-ink">Payment method</h2>
          <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Payment method">
            {PAYMENT_METHODS.map((m) => {
              const Icon = m.icon;
              const active = method === m.value;
              return (
                <button
                  key={m.value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMethod(m.value)}
                  className={`text-left flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    active
                      ? "border-primary-strong bg-primary-soft dark:bg-primary/10"
                      : "border-border hover:border-primary-soft"
                  }`}
                >
                  <Icon size={18} className={`mt-0.5 ${active ? "text-primary-strong dark:text-primary" : "text-faint"}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{m.label}</span>
                    <span className="block text-xs text-muted">{m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {method !== "cash" && (
            <label className="block">
              <span className="text-xs font-medium text-muted">Reference / transaction ID (optional)</span>
              <input
                className="input mt-1.5"
                placeholder="e.g. card or transfer reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          )}

          <div className="border-t border-border pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="text-ink font-medium">{formatCurrency(subtotal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Tax ({taxRate}%)</span>
              <span className="text-ink font-medium">{formatCurrency(tax, currencySymbol)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span className="text-ink">Total</span>
              <span className="text-ink">{formatCurrency(total, currencySymbol)}</span>
            </div>
          </div>

          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {mutation.isPending ? (
              <>
                <span className="h-4 w-4 rounded bg-white/40 animate-pulse" />
                Placing order...
              </>
            ) : (
              `Place order · ${formatCurrency(total, currencySymbol)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}