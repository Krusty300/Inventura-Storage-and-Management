import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, GripVertical, Loader2, Minus, Package, Plus, Search, Trash2, X } from "lucide-react";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Customer, Product, QualityCheck, Settings } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";
import { isSelectable, selectableProducts } from "../utils/variants";
import { MOBILE_MONEY_PROVIDERS, PAYMENT_METHODS } from "../utils/payments";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

interface LineItem {
  product_id: string;
  quantity: string;
  unit_price: string;
  location_id: string;
}

type LineField = "quantity" | "unit_price" | "location_id";

function CartLine({
  item,
  product,
  currency,
  blocked,
  onShortChange,
  onChange,
  onRemove,
}: {
  item: LineItem;
  product: Product | undefined;
  currency: string;
  blocked: boolean;
  onShortChange: (short: boolean) => void;
  onChange: (field: LineField, value: string) => void;
  onRemove: () => void;
}) {
  const { locations: stockLocations, unallocated, isLoading: stockLoading } = useProductStockLocations(product?.id, false);

  const qty = parseInt(item.quantity);
  const locationId = item.location_id ? parseInt(item.location_id) : null;
  let available: number | undefined;
  if (product && !stockLoading) {
    if (locationId) {
      available = stockLocations.find((l) => l.location_id === locationId)?.count ?? 0;
    } else {
      available = stockLocations.reduce((sum, l) => sum + l.count, 0) + unallocated;
    }
  }
  const short = !!product && !stockLoading && available !== undefined && !Number.isNaN(qty) && qty > 0 && qty > available;

  const prevShort = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevShort.current !== short) {
      prevShort.current = short;
      onShortChange(short);
    }
  }, [short, onShortChange]);

  const lineTotal = (parseInt(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);

  return (
    <div className="border border-border rounded-lg bg-surface p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {product?.image_url ? (
            <img src={product.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded bg-subtle flex items-center justify-center shrink-0">
              <Package size={16} className="text-faint" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm text-ink truncate" title={product?.display_name}>
              {product?.display_name || `Product #${item.product_id}`}
            </p>
            <p className="text-xs text-faint">{product?.sku}</p>
          </div>
        </div>
        <button type="button" onClick={onRemove} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove item">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-lg border border-border overflow-hidden shrink-0">
          <button type="button" onClick={() => onChange("quantity", String(Math.max(1, (parseInt(item.quantity) || 1) - 1)))} className="p-1.5 text-muted hover:bg-app" aria-label="Decrease quantity">
            <Minus size={14} />
          </button>
          <input
            type="number"
            className="w-14 text-center input !rounded-none !border-0 text-sm"
            value={item.quantity}
            onChange={(e) => onChange("quantity", e.target.value)}
            min="1"
            aria-label={`Quantity for ${product?.display_name || item.product_id}`}
          />
          <button type="button" onClick={() => onChange("quantity", String((parseInt(item.quantity) || 0) + 1))} className="p-1.5 text-muted hover:bg-app" aria-label="Increase quantity">
            <Plus size={14} />
          </button>
        </div>
        <label className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-muted">
          <span className="shrink-0">Price</span>
          <input type="number" className="input !py-1.5 text-sm w-full min-w-0" value={item.unit_price} onChange={(e) => onChange("unit_price", e.target.value)} step="0.01" min="0" aria-label={`Unit price for ${product?.display_name || item.product_id}`} />
        </label>
        <span className="font-semibold text-sm whitespace-nowrap shrink-0">{formatCurrency(lineTotal, currency)}</span>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-muted">
          <span className="shrink-0">Fulfill from</span>
          {stockLoading && <Loader2 size={10} className="animate-spin shrink-0" />}
          <select className="select !py-1 text-xs min-w-0 flex-1" value={item.location_id} onChange={(e) => onChange("location_id", e.target.value)} disabled={!product} aria-label="Fulfill from location">
            <option value="">Auto (any location)</option>
            {stockLocations.map((l) => (
              <option key={l.location_id} value={l.location_id.toString()}>{l.path} ({l.count})</option>
            ))}
          </select>
        </label>
      </div>

      {blocked && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Pending quality check — can't be sold until resolved.</span>
        </div>
      )}
      {short && available !== undefined && (
        <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {locationId
              ? `Only ${available} available at this location.`
              : `Only ${available} total available.`}
          </span>
        </div>
      )}
    </div>
  );
}

export default function SaleForm({ onClose, onSaved }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pendingQcs, setPendingQcs] = useState<QualityCheck[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentProvider, setPaymentProvider] = useState(MOBILE_MONEY_PROVIDERS[0].value);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [stockShort, setStockShort] = useState<Set<number>>(new Set());
  const [discount, setDiscount] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [saving, setSaving] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [cartWidth, setCartWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const min = 320;
      const max = Math.max(min, Math.floor(rect.width * 0.6));
      setCartWidth(Math.round(Math.max(min, Math.min(rect.right - ev.clientX, max))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    api.get("/customers", { params: { limit: PAGE_SIZE_PRODUCTS } }).then(({ data }) => setCustomers(data.items));
    api.get("/products", { params: { active_only: true, limit: PAGE_SIZE_PRODUCTS, include_variants: 1 } }).then(({ data }) => setProducts(data.items));
    api.get("/settings").then(({ data }) => setSettings(data));
    api.get("/quality-checks", { params: { result: "pending", limit: PAGE_SIZE } }).then(({ data }) => setPendingQcs(data.items));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectable = useMemo(() => selectableProducts(products), [products]);
  const sellable = useMemo(() => selectable.filter((p) => !p.is_serialized), [selectable]);

  const blockedProductIds = useMemo(() => {
    const set = new Set<number>();
    for (const qc of pendingQcs) if (qc.product_id) set.add(qc.product_id);
    return set;
  }, [pendingQcs]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const p of sellable) if (p.category_name) names.add(p.category_name);
    return ["All", ...[...names].sort()];
  }, [sellable]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sellable.filter((p) => {
      if (category !== "All" && p.category_name !== category) return false;
      if (!q) return true;
      return `${p.display_name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q);
    });
  }, [sellable, query, category]);

  const isBlocked = (item: LineItem) => {
    const productId = parseInt(item.product_id);
    if (!productId) return false;
    const locationId = item.location_id ? parseInt(item.location_id) : null;
    return pendingQcs.some(
      (qc) => qc.product_id === productId &&
        (qc.location_id === null || locationId === null || qc.location_id === locationId),
    );
  };

  const handleStockShort = useCallback((productId: string, short: boolean) => {
    const id = parseInt(productId);
    if (!id) return;
    setStockShort((prev) => {
      const has = prev.has(id);
      if (has === short) return prev;
      const next = new Set(prev);
      if (short) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const addProduct = (p: Product) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => parseInt(i.product_id) === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: String((parseInt(next[idx].quantity) || 0) + 1) };
        return next;
      }
      return [...prev, { product_id: p.id.toString(), quantity: "1", unit_price: p.unit_price.toString(), location_id: "" }];
    });
  };

  const updateItem = (idx: number, field: LineField, value: string) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = items.reduce((sum, i) => sum + (parseInt(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const discountAmount = Math.min(Math.max(parseFloat(discount) || 0, 0), subtotal);
  const taxable = subtotal - discountAmount;
  const tax = settings ? taxable * settings.tax_rate / 100 : 0;
  const total = taxable + tax;
  const currency = settings?.currency_symbol || "$";

  const cashReceived = parseFloat(amountReceived) || 0;
  const change = cashReceived - total;
  const cashShort = paymentMethod === "cash" && amountReceived.trim() !== "" && cashReceived < total;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      addToast("Add at least one item to the sale", "error");
      return;
    }
    if (items.some((i) => !i.product_id)) {
      addToast("All line items must have a product selected", "error");
      return;
    }
    if (items.some((i) => {
      if (!i.product_id) return false;
      const q = parseInt(i.quantity);
      return Number.isNaN(q) || q <= 0;
    })) {
      addToast("Line item quantities must be at least 1", "error");
      return;
    }
    if (items.some((i) => stockShort.has(parseInt(i.product_id)))) {
      addToast("One or more line items exceed the available stock", "error");
      return;
    }
    if (items.some(isBlocked)) {
      addToast("A line item has a pending quality check and can't be sold yet", "error");
      return;
    }
    if (discountAmount !== (parseFloat(discount) || 0)) {
      addToast("Discount cannot exceed the subtotal", "error");
      return;
    }
    if (cashShort) {
      addToast("Amount received is less than the total", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/sales", {
        customer_id: customerId ? parseInt(customerId) : null,
        payment_method: paymentMethod,
        payment_provider: paymentMethod === "mobile_money" ? paymentProvider : null,
        discount_amount: discountAmount,
        notes,
        items: items.map((i) => ({
          product_id: parseInt(i.product_id),
          quantity: parseInt(i.quantity),
          unit_price: parseFloat(i.unit_price) || 0,
          location_id: i.location_id ? parseInt(i.location_id) : null,
        })),
      });
      addToast(paymentMethod === "cash" && cashReceived >= total
        ? `Sale completed — change due ${formatCurrency(Math.max(change, 0), currency)}`
        : "Sale completed", "success");
      onSaved();
    } catch (err: any) {
      addToast(errorMessage(err, "Error processing sale"), "error");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-app flex flex-col" role="dialog" aria-modal="true" aria-label="Point of sale register">
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-ink">Register</h2>
          <span className="text-xs text-muted hidden sm:inline">Tap a product to add it to the sale</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <BarcodeScanner
            onProductFound={(p) => {
              if (p.is_serialized) { addToast("Serialized products can't be sold at checkout - create a shipment instead", "error"); return; }
              if (isSelectable(p)) addProduct(p); else addToast("Product has variants - scan a specific variant", "error");
            }}
            placeholder="Scan to add item..."
            autoFocus
          />
          <button type="button" onClick={onClose} className="btn-secondary flex items-center gap-1.5" aria-label="Close register">
            <X size={16} />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 flex flex-col lg:flex-row overflow-hidden select-none">
        <section className="min-w-0 flex-1 flex flex-col overflow-hidden" aria-label="Product catalog">
          <div className="px-6 py-3 border-b border-border bg-surface space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                className="input pl-9"
                placeholder="Search products by name, SKU or barcode..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search products"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${
                    category === c ? "bg-indigo-600 text-white border-indigo-600" : "bg-surface border-border text-muted hover:border-indigo-300"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {sellable.length === 0 ? (
              <p className="text-muted text-sm py-16 text-center">No sellable products found</p>
            ) : visibleProducts.length === 0 ? (
              <p className="text-muted text-sm py-16 text-center">No products match your search</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {visibleProducts.map((p) => {
                  const blocked = blockedProductIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (blocked) {
                          addToast(`'${p.display_name}' has a pending quality check and can't be sold yet`, "error");
                          return;
                        }
                        addProduct(p);
                      }}
                      className={`text-left border rounded-xl p-4 bg-surface transition-colors relative ${
                        blocked
                          ? "border-amber-300 dark:border-amber-500/40 hover:border-amber-400"
                          : "border-border hover:border-indigo-400 hover:shadow-sm"
                      }`}
                    >
                      {blocked && (
                        <span className="absolute top-2 right-2" title="Pending quality check">
                          <AlertTriangle size={14} className="text-amber-500" />
                        </span>
                      )}
                      <div className="h-28 mb-2 rounded-lg overflow-hidden bg-subtle flex items-center justify-center">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.display_name} className="w-full h-full object-cover" />
                        ) : (
                          <Package size={28} className="text-faint" />
                        )}
                      </div>
                      <p className="font-semibold text-sm text-ink line-clamp-2">{p.display_name}</p>
                      <p className="text-xs text-faint mt-0.5">{p.sku}</p>
                      <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-2">{formatCurrency(p.unit_price, currency)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {isWide && (
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startResize}
            className="hidden lg:flex w-3.5 shrink-0 items-center justify-center cursor-col-resize bg-surface border-x border-border text-faint hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
            style={{ touchAction: "none" }}
            title="Drag to resize"
          >
            <GripVertical size={14} />
          </div>
        )}

        <aside
          className="shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface flex flex-col h-[45vh] lg:h-auto"
          style={{ width: isWide ? `${cartWidth}px` : undefined }}
          aria-label="Sale cart"
        >
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-border space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Customer</label>
                  <select className="select text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer">
                    <option value="">Walk-in</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Payment</label>
                  <select className="select text-sm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} aria-label="Payment method">
                    {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              {paymentMethod === "mobile_money" && (
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Mobile Money Provider</label>
                  <select className="select text-sm" value={paymentProvider} onChange={(e) => setPaymentProvider(e.target.value)} aria-label="Mobile money provider">
                    {MOBILE_MONEY_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              )}
              <textarea className="input text-sm" rows={1} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Sale notes" />
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {items.length === 0 ? (
                <p className="text-muted text-sm text-center py-10">Cart is empty — tap a product to add it</p>
              ) : (
                items.map((item, idx) => (
                  <CartLine
                    key={item.product_id}
                    item={item}
                    product={sellable.find((p) => p.id === parseInt(item.product_id))}
                    currency={currency}
                    blocked={isBlocked(item)}
                    onShortChange={(short) => handleStockShort(item.product_id, short)}
                    onChange={(field, value) => updateItem(idx, field, value)}
                    onRemove={() => removeItem(idx)}
                  />
                ))
              )}
            </div>

            <div className="px-5 py-4 border-t border-border space-y-3 bg-app">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Subtotal</span>
                <span>{formatCurrency(subtotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-muted shrink-0">Discount</span>
                <div className="relative flex-1 max-w-[160px]">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">{currency}</span>
                  <input
                    type="number"
                    className="input pl-6 py-1.5 text-sm"
                    placeholder="0.00"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    min="0"
                    step="0.01"
                    aria-label="Discount amount"
                  />
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Tax ({settings?.tax_rate ?? 0}%)</span>
                <span>{formatCurrency(tax, currency)}</span>
              </div>
              <div className="flex justify-between items-baseline border-t border-border pt-2">
                <span className="font-semibold">Total</span>
                <span className="text-2xl font-bold text-ink">{formatCurrency(total, currency)}</span>
              </div>
            </div>

            {paymentMethod === "cash" && (
              <div className="px-5 py-4 border-t border-border space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Cash received</span>
                  <span className={`font-semibold ${cashShort ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    Change {formatCurrency(Math.max(change, 0), currency)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input py-1.5 text-sm flex-1"
                    placeholder="Amount received"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    min="0"
                    step="0.01"
                    aria-label="Cash received"
                  />
                  <button type="button" onClick={() => setAmountReceived(total.toFixed(2))} className="btn-secondary text-xs px-2 py-1.5">Exact</button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[5, 10, 20, 50].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAmountReceived((cashReceived + n).toFixed(2))}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted hover:bg-app"
                    >
                      +{n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-t border-border">
              <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-base font-semibold">
                {saving ? "Processing..." : `Complete Sale · ${formatCurrency(total, currency)}`}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
