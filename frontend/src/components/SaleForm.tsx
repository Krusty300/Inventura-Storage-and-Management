import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, GripVertical, KeyRound, Loader2, Lock, Minus, PackageOpen, Plus, Search, Send, Trash2, Unlock, X } from "lucide-react";
import EmptyState from "./EmptyState";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Customer, Product, Promotion, QualityCheck, SalesChannel, Settings } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";
import type { Sale } from "../types";
import { isSelectable, selectableProducts } from "../utils/variants";
import { MOBILE_MONEY_PROVIDERS, paymentLabel } from "../utils/payments";
import { getPlaceholder, onImageError } from "../utils/placeholders";
import { productImageUrl } from "../utils/images";
import FittedSelect from "./FittedSelect";
import CustomerPicker from "./CustomerPicker";
import PasswordInput from "./PasswordInput";
import TextArea from "./TextArea";
import PaymentMethodPicker from "./PaymentMethodPicker";
import CartSwitcher from "./CartSwitcher";
import ScrollArea from "./ScrollArea";
import HoverCard from "./HoverCard";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { loadCartWidth, saveCartWidth } from "../hooks/useSaleDraft";
import {
  getPersistedSavedAt,
  hasPersistedCarts,
  useDebouncedAutosave,
  useMultiCart,
  type MultiCartDraft,
  type MultiCartDraftInput,
} from "../hooks/useMultiCart";

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
  disabled,
  onShortChange,
  onChange,
  onRemove,
}: {
  item: LineItem;
  product: Product | undefined;
  currency: string;
  blocked: boolean;
  disabled: boolean;
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
          <img src={productImageUrl(product)} alt="" className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" onError={onImageError} />
          <div className="min-w-0">
            <p className="font-medium text-sm text-ink truncate" title={product?.display_name}>
              {product?.display_name || `Product #${item.product_id}`}
            </p>
            <p className="text-xs text-faint">{product?.sku}</p>
          </div>
        </div>
        <button type="button" onClick={onRemove} disabled={disabled} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40" aria-label="Remove item">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-lg border border-border overflow-hidden shrink-0">
          <button type="button" onClick={() => onChange("quantity", String(Math.max(1, (parseInt(item.quantity) || 1) - 1)))} disabled={disabled} className="h-9 w-9 inline-flex items-center justify-center text-muted hover:bg-app disabled:opacity-40" aria-label="Decrease quantity">
            <Minus size={16} />
          </button>
          <input
            type="number"
            className="w-14 text-center input !rounded-none !border-0 text-sm"
            value={item.quantity}
            onChange={(e) => onChange("quantity", e.target.value)}
            min="1"
            disabled={disabled}
            aria-label={`Quantity for ${product?.display_name || item.product_id}`}
          />
          <button type="button" onClick={() => onChange("quantity", String((parseInt(item.quantity) || 0) + 1))} disabled={disabled} className="h-9 w-9 inline-flex items-center justify-center text-muted hover:bg-app disabled:opacity-40" aria-label="Increase quantity">
            <Plus size={16} />
          </button>
        </div>
        <label className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-muted">
          <span className="shrink-0">Price</span>
          <input type="number" className="input !py-1.5 text-sm w-full min-w-0" value={item.unit_price} onChange={(e) => onChange("unit_price", e.target.value)} step="0.01" min="0" disabled={disabled} aria-label={`Unit price for ${product?.display_name || item.product_id}`} />
        </label>
        <span className="font-semibold text-sm whitespace-nowrap shrink-0">{formatCurrency(lineTotal, currency)}</span>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-muted">
          <span className="shrink-0">Fulfill from</span>
          {stockLoading && <Loader2 size={10} className="animate-spin shrink-0" />}
          <FittedSelect
            ariaLabel="Fulfill from location"
            value={item.location_id}
            onChange={(v) => onChange("location_id", v)}
            disabled={!product || disabled}
            options={[
              { value: "", label: "Auto (any location)" },
              ...stockLocations.map((l) => ({
                value: l.location_id.toString(),
                label: `${l.path} (${l.count})`,
              })),
            ]}
          />
        </label>
      </div>

      {blocked && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Pending/failed quality check at the selected fulfillment location — choose a different location or resolve the QC before selling.</span>
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

interface CartSummaryCardProps {
  items: LineItem[];
  productById: Map<number, Product>;
  subtotal: number;
  discountAmount: number;
  effectivePromoDiscount: number;
  promoCode: string;
  tax: number;
  total: number;
  currency: string;
  payment: string;
}

function CartSummaryCard({
  items,
  productById,
  subtotal,
  discountAmount,
  effectivePromoDiscount,
  promoCode,
  tax,
  total,
  currency,
  payment,
}: CartSummaryCardProps) {
  const totalQty = items.reduce((sum, i) => sum + (parseInt(i.quantity) || 0), 0);
  const visible = items.slice(0, 6);
  const remaining = items.length - visible.length;

  return (
    <div className="animate-dt-pop w-full space-y-3 rounded-xl bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Cart Summary</p>
        <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
          {items.length} {items.length === 1 ? "line" : "lines"} · {totalQty} qty
        </span>
      </div>

      <div className={`space-y-1.5 ${items.length > 6 ? "max-h-44 overflow-y-auto pr-0.5" : ""}`}>
        {visible.map((item) => {
          const product = productById.get(parseInt(item.product_id));
          const qty = parseInt(item.quantity) || 0;
          const unitPrice = parseFloat(item.unit_price) || 0;
          return (
            <div key={item.product_id} className="flex items-center gap-2 min-w-0">
              <img src={productImageUrl(product)} alt="" className="h-7 w-7 shrink-0 rounded object-cover" loading="lazy" onError={onImageError} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={product?.display_name}>
                  {product?.display_name || `Product #${item.product_id}`}
                </p>
                <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                  {qty} × {formatCurrency(unitPrice, currency)}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums">{formatCurrency(qty * unitPrice, currency)}</span>
            </div>
          );
        })}
        {remaining > 0 && <p className="text-[11px] text-slate-400 dark:text-slate-500">+ {remaining} more {remaining === 1 ? "line" : "lines"}</p>}
      </div>

      <div className="space-y-1 border-t border-slate-200 pt-2 text-xs dark:border-slate-700">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
          <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Discount</span>
            <span className="tabular-nums text-red-600 dark:text-red-400">-{formatCurrency(discountAmount, currency)}</span>
          </div>
        )}
        {effectivePromoDiscount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Promo ({promoCode.trim().toUpperCase()})</span>
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">-{formatCurrency(effectivePromoDiscount, currency)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Tax</span>
          <span className="tabular-nums">{formatCurrency(tax, currency)}</span>
        </div>
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-semibold text-slate-900 dark:text-slate-100">Total</span>
          <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(total, currency)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
          <span>Payment</span>
          <span className="font-medium">{payment}</span>
        </div>
      </div>
    </div>
  );
}

export default function SaleForm({ onClose, onSaved }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pendingQcs, setPendingQcs] = useState<QualityCheck[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentProvider, setPaymentProvider] = useState(MOBILE_MONEY_PROVIDERS[0].value);
  const [paymentPhone, setPaymentPhone] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentProviderAmount, setPaymentProviderAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [stockShort, setStockShort] = useState<Set<number>>(new Set());
  const [discount, setDiscount] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoError, setPromoError] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [activePromos, setActivePromos] = useState<Promotion[]>([]);
  const [suggestedPromo, setSuggestedPromo] = useState<{ promo: Promotion; discount: number } | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [amountReceived, setAmountReceived] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [saving, setSaving] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [stkPending, setStkBilling] = useState(false);
  const [stkSent, setStkSent] = useState(false);
  const [stkError, setStkError] = useState("");
  const [cartWidth, setCartWidth] = useState(() => loadCartWidth() ?? 400);
  const containerRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();
  const formatDateTime = useDateTimeFormat();

  const [isLocked, setIsLocked] = useState(() => hasPersistedCarts());
  const [isDraftRestored, setIsDraftRestored] = useState(() => hasPersistedCarts());
  const [lockUsername, setLockUsername] = useState("");
  const [lockPassword, setLockPassword] = useState("");
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(() =>
    hasPersistedCarts() ? getPersistedSavedAt() : null,
  );
  const [restoreNonce, setRestoreNonce] = useState(0);
  const lockInputRef = useRef<HTMLInputElement>(null);

  const getStateForDraft = useCallback((): MultiCartDraftInput | null => {
    if (isLocked || isDraftRestored || completedSale) return null;
    if (items.length === 0) return null;
    return {
      customerId,
      channelId,
      paymentMethod,
      paymentProvider,
      paymentPhone,
      paymentReference,
      paymentProviderAmount,
      notes,
      discount,
      promoCode,
      promoDiscount,
      amountReceived,
      items,
    };
  }, [customerId, channelId, paymentMethod, paymentProvider, paymentPhone, paymentReference, paymentProviderAmount, notes, discount, promoCode, promoDiscount, amountReceived, items, isLocked, isDraftRestored, completedSale]);

  const {
    carts,
    activeCart,
    activeCartId,
    createCart,
    switchCart,
    deleteCart,
    updateCart,
    clearActiveCart,
    restoreCarts,
    discardPersisted,
  } = useMultiCart(!isLocked && !isDraftRestored);

  const activeCartIdRef = useRef(activeCartId);
  useEffect(() => {
    activeCartIdRef.current = activeCartId;
  }, [activeCartId]);

  const saveDraftToCart = useCallback((draft: MultiCartDraftInput) => {
    updateCart(activeCartIdRef.current, { ...draft, savedAt: new Date().toISOString() });
  }, [updateCart]);

  const { scheduleSave, flushSave } = useDebouncedAutosave(
    getStateForDraft,
    !isLocked && !isDraftRestored,
    saveDraftToCart,
  );

  useEffect(() => {
    scheduleSave();
  }, [customerId, channelId, paymentMethod, paymentProvider, paymentPhone, paymentReference, paymentProviderAmount, notes, discount, amountReceived, items, promoCode, promoDiscount, scheduleSave]);

  const handleClose = useCallback(() => {
    flushSave();
    onClose();
  }, [flushSave, onClose]);

  const activeDraftRef = useRef<MultiCartDraft | null>(activeCart.draft);
  useEffect(() => {
    activeDraftRef.current = activeCart.draft;
  }, [activeCart.draft]);

  const applyCartDraft = useCallback((draft: MultiCartDraft | null) => {
    if (!draft) {
      setCustomerId("");
      setChannelId("");
      setPaymentMethod("cash");
      setPaymentProvider(MOBILE_MONEY_PROVIDERS[0].value);
      setPaymentPhone("");
      setPaymentReference("");
      setPaymentProviderAmount("");
      setNotes("");
      setDiscount("");
      setAmountReceived("");
      setItems([]);
      setPromoCode("");
      setPromoDiscount(0);
      setPromoError("");
      setStockShort(new Set());
      setSuggestionDismissed(false);
      setSuggestedPromo(null);
      return;
    }
    setCustomerId(draft.customerId);
    setChannelId(draft.channelId || "");
    setPaymentMethod(draft.paymentMethod);
    setPaymentProvider(draft.paymentProvider);
    setPaymentPhone(draft.paymentPhone);
    setPaymentReference(draft.paymentReference);
    setPaymentProviderAmount(draft.paymentProviderAmount);
    setNotes(draft.notes);
    setDiscount(draft.discount);
    setPromoCode(draft.promoCode);
    setPromoDiscount(draft.promoDiscount);
    setPromoError("");
    setSuggestionDismissed(false);
    setSuggestedPromo(null);
    setAmountReceived(draft.amountReceived);
    setStockShort(new Set());
    setItems(draft.items);
  }, []);

  useEffect(() => {
    applyCartDraft(activeDraftRef.current);
  }, [activeCartId, restoreNonce, applyCartDraft]);

  const isWide = useMediaQuery("(min-width: 1024px)");

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
    if (cartWidth !== 400) saveCartWidth(cartWidth);
  }, [cartWidth]);

  useEffect(() => {
    let cancelled = false;
    const fail = () => {
      if (!cancelled) addToast("Could not load store data. Check your connection and reopen the register.", "error");
    };
    api.get("/customers", { params: { limit: PAGE_SIZE_PRODUCTS } }).then(({ data }) => { if (!cancelled) setCustomers(data.items); }).catch(fail);
    api.get("/products", { params: { active_only: true, limit: PAGE_SIZE_PRODUCTS, include_variants: 1 } }).then(({ data }) => { if (!cancelled) setProducts(data.items); }).catch(fail);
    api.get("/sales-channels/all").then(({ data }) => { if (!cancelled) setChannels(data); }).catch(fail);
    api.get("/settings").then(({ data }) => { if (!cancelled) setSettings(data); }).catch(fail);
    Promise.all([
      api.get("/quality-checks", { params: { result: "pending", limit: PAGE_SIZE } }),
      api.get("/quality-checks", { params: { result: "fail", limit: PAGE_SIZE } }),
    ]).then(([pending, failed]) => { if (!cancelled) setPendingQcs([...pending.data.items, ...failed.data.items]); }).catch(fail);
    api.get("/promotions", { params: { active_only: true, limit: 50 } }).then(({ data }) => { if (!cancelled) setActivePromos(data.items); }).catch(fail);
    return () => { cancelled = true; };
  }, [addToast]);

  useEffect(() => {
    if (isLocked) {
      lockInputRef.current?.focus();
    }
  }, [isLocked]);

  useEffect(() => {
    if (isDraftRestored && !isLocked) {
      setIsDraftRestored(false);
    }
  }, [isDraftRestored, isLocked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[aria-label="Command palette"]')) return;
      handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const selectable = useMemo(() => selectableProducts(products), [products]);
  const sellable = useMemo(() => selectable.filter((p) => !p.is_serialized), [selectable]);
  const productById = useMemo(() => new Map(sellable.map((p) => [p.id, p])), [sellable]);

  const blockedProductIds = useMemo(() => {
    const set = new Set<number>();
    for (const qc of pendingQcs) if (qc.product_id && qc.location_id === null) set.add(qc.product_id);
    return set;
  }, [pendingQcs]);

  const warnedProductIds = useMemo(() => {
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

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockUsername.trim() || !lockPassword) return;
    setLockLoading(true);
    setLockError("");
    try {
      await api.post("/auth/verify", { username: lockUsername.trim(), password: lockPassword });
      setDraftSavedAt(getPersistedSavedAt());
      restoreCarts();
      setRestoreNonce((n) => n + 1);
      setIsLocked(false);
      setIsDraftRestored(false);
      setLockUsername("");
      setLockPassword("");
      addToast("Draft restored", "success");
    } catch (err: unknown) {
      setLockError(errorMessage(err, "Invalid credentials"));
    }
    setLockLoading(false);
  };

  const handleLock = () => {
    flushSave();
    setIsLocked(true);
    setIsDraftRestored(false);
    setLockError("");
  };

  const handleUnlockFromHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockUsername.trim() || !lockPassword) return;
    setLockLoading(true);
    setLockError("");
    try {
      await api.post("/auth/verify", { username: lockUsername.trim(), password: lockPassword });
      setIsLocked(false);
      setLockUsername("");
      setLockPassword("");
      addToast("Form unlocked", "success");
    } catch (err: unknown) {
      setLockError(errorMessage(err, "Invalid credentials"));
    }
    setLockLoading(false);
  };

  const handleDiscardDraft = () => {
    discardPersisted();
    applyCartDraft(null);
    setIsLocked(false);
    setIsDraftRestored(false);
    setDraftSavedAt(null);
    addToast("Draft discarded", "success");
  };

  const cartSummaries = useMemo(
    () => carts.map((c) => ({ id: c.id, name: c.name, count: c.draft?.items.length ?? 0 })),
    [carts],
  );

  const handleCreateCart = () => {
    if (isLocked) return;
    flushSave();
    createCart();
  };

  const handleSwitchCart = (id: string) => {
    if (isLocked || id === activeCartId) return;
    flushSave();
    switchCart(id);
  };

  const handleDeleteCart = (id: string) => {
    if (isLocked) return;
    flushSave();
    deleteCart(id);
  };

  const addProduct = (p: Product) => {
    if (isLocked) return;
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
  const effectivePromoDiscount = Math.min(promoDiscount, subtotal - discountAmount);
  const taxable = subtotal - discountAmount - effectivePromoDiscount;
  const tax = settings ? taxable * settings.tax_rate / 100 : 0;
  const total = taxable + tax;
  const currency = settings?.currency_symbol || "$";
  const saleSymbol = currency;
  const currencyCode = settings?.currency_code || "USD";

  useEffect(() => {
    if (promoCode.trim() || suggestionDismissed || items.length === 0) {
      setSuggestedPromo(null);
      return;
    }
    const totalQty = items.reduce((sum, i) => sum + (parseInt(i.quantity) || 0), 0);
    const candidates = activePromos.filter((p) => {
      if (p.min_amount > 0 && subtotal < p.min_amount) return false;
      if (p.min_qty > 0 && totalQty < p.min_qty) return false;
      if (p.max_uses > 0 && p.used_count >= p.max_uses) return false;
      return true;
    });
    if (candidates.length === 0) { setSuggestedPromo(null); return; }
    let cancelled = false;
    const check = async () => {
      let best: { promo: Promotion; discount: number } | null = null;
      for (const p of candidates.slice(0, 5)) {
        try {
          const { data } = await api.post("/promotions/validate", { code: p.code, subtotal, total_qty: totalQty });
          if (data.valid && data.discount_amount > 0) {
            if (!best || data.discount_amount > best.discount) {
              best = { promo: p, discount: data.discount_amount };
            }
          }
        } catch { /* skip */ }
      }
      if (!cancelled) setSuggestedPromo(best);
    };
    const timer = setTimeout(check, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [items, subtotal, promoCode, suggestionDismissed, activePromos]);

  const cashReceived = parseFloat(amountReceived) || 0;
  const change = cashReceived - total;
  const cashShort = paymentMethod === "cash" && amountReceived.trim() !== "" && cashReceived < total;

  const validatePromo = async (codeOverride?: string) => {
    const code = (codeOverride ?? promoCode).trim().toUpperCase();
    if (!code) { setPromoDiscount(0); setPromoError(""); return; }
    setPromoValidating(true);
    try {
      const totalQty = items.reduce((sum, i) => sum + (parseInt(i.quantity) || 0), 0);
      const { data } = await api.post("/promotions/validate", { code, subtotal, total_qty: totalQty });
      if (data.valid) {
        setPromoDiscount(data.discount_amount);
        setPromoError("");
      } else {
        setPromoDiscount(0);
        setPromoError(data.error || "Invalid promo code");
      }
    } catch {
      setPromoDiscount(0);
      setPromoError("Failed to validate promo code");
    }
    setPromoValidating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
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
      addToast("A line item has a pending/failed quality check at its fulfillment location and can't be sold yet", "error");
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
      const { data: sale } = await api.post("/sales", {
        customer_id: customerId ? parseInt(customerId) : null,
        channel_id: channelId ? parseInt(channelId) : null,
        payment_method: paymentMethod,
        payment_provider: paymentMethod === "mobile_money" ? paymentProvider : null,
        payment_reference: paymentReference.trim() || null,
        payment_phone: paymentPhone.trim() || null,
        payment_provider_amount: paymentMethod === "mobile_money" && paymentProviderAmount ? parseFloat(paymentProviderAmount) : null,
        currency: currencyCode,
        currency_symbol: currency,
        discount_amount: discountAmount,
        promo_code: promoCode.trim().toUpperCase() || null,
        notes,
        items: items.map((i) => ({
          product_id: parseInt(i.product_id),
          quantity: parseInt(i.quantity),
          unit_price: parseFloat(i.unit_price) || 0,
          location_id: i.location_id ? parseInt(i.location_id) : null,
        })),
      }) as { data: Sale };
      clearActiveCart();
      if (paymentMethod === "mobile_money") {
        setCompletedSale(sale);
        addToast("Sale created — collect payment via STK Push", "success");
      } else {
        applyCartDraft(null);
        addToast(paymentMethod === "cash" && cashReceived >= total
          ? `Sale completed — change due ${formatCurrency(Math.max(change, 0), currency)}`
          : "Sale completed", "success");
        onSaved();
      }
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error processing sale"), "error");
    }
    setSaving(false);
  };

  const handleStkPush = async () => {
    if (!completedSale || !paymentPhone.trim()) return;
    setStkBilling(true);
    setStkError("");
    try {
      // The server derives the amount and records the checkout id, so the
      // prompt cannot be for a different figure than the sale.
      const { data } = await api.post(`/sales/${completedSale.id}/stk-push`, {
        phone: paymentPhone.trim(),
      });
      if (data.success) {
        setStkSent(true);
        addToast("STK Push sent — awaiting customer confirmation", "success");
      } else {
        setStkError(data.message || "STK Push failed");
      }
    } catch (err: unknown) {
      setStkError(errorMessage(err, "STK Push failed"));
    }
    setStkBilling(false);
  };

  const handleDismissStk = () => {
    applyCartDraft(null);
    setCompletedSale(null);
    setStkSent(false);
    setStkError("");
  };

  const formDisabled = isLocked;

  if (completedSale) {
    return (
      <div className="fixed inset-0 z-50 bg-app flex flex-col items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Payment collection">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2">
              <Send size={28} />
            </div>
            <h2 className="text-xl font-bold text-ink">Payment Required</h2>
            <p className="text-sm text-muted">
              Invoice <span className="font-medium text-ink">{completedSale.invoice_number}</span> created
            </p>
          </div>

          <div className="card space-y-4 p-6">
            <div className="text-center">
              <p className="text-sm text-muted">Total amount</p>
              <p className="text-3xl font-bold text-ink">{formatCurrency(completedSale.total_amount, saleSymbol)}</p>
            </div>

            {!stkSent ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Phone number ({paymentLabel("mobile_money", paymentProvider)})</label>
                  <input
                    className="input text-sm"
                    placeholder="e.g. 07XX XXX XXX"
                    value={paymentPhone}
                    onChange={(e) => setPaymentPhone(e.target.value)}
                    autoFocus
                    aria-label="STK push phone number"
                  />
                </div>
                {stkError && (
                  <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{stkError}</div>
                )}
                <button
                  onClick={handleStkPush}
                  disabled={stkPending || !paymentPhone.trim()}
                  className="btn-primary w-full py-3 text-base font-semibold flex items-center justify-center gap-2"
                >
                  {stkPending ? <><Loader2 size={18} className="animate-spin" />Sending STK Push...</> : <><Send size={18} />Send STK Push</>}
                </button>
              </div>
            ) : (
              <div className="text-center space-y-3">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm font-medium">
                  <Loader2 size={14} className="animate-spin" />Awaiting customer confirmation...
                </div>
                <p className="text-xs text-muted">The customer will receive an M-Pesa prompt on their phone ({paymentPhone}).</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={handleDismissStk} className="btn-secondary flex-1">
              {stkSent ? "Done" : "Skip for now"}
            </button>
            {stkSent && (
              <button onClick={() => { handleDismissStk(); onSaved(); }} className="btn-primary flex-1">
                New Sale
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-app flex flex-col" role="dialog" aria-modal="true" aria-label="Point of sale register">

      {isLocked && isDraftRestored && (
        <div className="absolute inset-0 z-[60] bg-app/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="card p-8 max-w-sm w-full space-y-6 text-center">
            <div className="mx-auto w-24 h-24 rounded-2xl overflow-hidden bg-subtle border border-border">
              <img src={getPlaceholder()} alt="" className="w-full h-full object-cover" loading="lazy" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-ink">Draft Locked</h3>
              <p className="text-sm text-muted">
                Your previous draft was restored.
                {draftSavedAt && (
                  <span className="block mt-1 text-xs text-faint">
                    Saved {formatDateTime(draftSavedAt)}
                  </span>
                )}
              </p>
            </div>
            <form onSubmit={handleUnlock} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Username</label>
                <input
                  ref={lockInputRef}
                  className="input text-sm"
                  placeholder="Enter your username"
                  value={lockUsername}
                  onChange={(e) => setLockUsername(e.target.value)}
                  autoComplete="username"
                  aria-label="Locked form username"
                />
              </div>
              <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
                  <PasswordInput
                    id="sale-lock-password"
                    className="text-sm"
                    placeholder="Enter your password"
                    value={lockPassword}
                    onChange={setLockPassword}
                    autoComplete="current-password"
                    ariaLabel="Locked form password"
                  />
                </div>
              {lockError && (
                <p className="text-xs text-red-600 dark:text-red-400">{lockError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleDiscardDraft} className="btn-secondary flex-1 text-sm">
                  Discard Draft
                </button>
                <button type="submit" disabled={lockLoading || !lockUsername.trim() || !lockPassword} className="btn-primary flex-1 text-sm flex items-center justify-center gap-1.5">
                  {lockLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {lockLoading ? "Verifying..." : "Unlock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLocked && !isDraftRestored && (
        <div className="absolute inset-0 z-[60] flex">
          <div className="w-full h-full flex flex-col items-center justify-center p-6">
            <div className="card p-8 max-w-sm w-full space-y-6 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
                <Lock size={28} className="text-primary dark:text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-ink">Form Locked</h3>
                <p className="text-sm text-muted">Enter your credentials to unlock.</p>
              </div>
              <form onSubmit={handleUnlockFromHeader} className="space-y-3 text-left">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Username</label>
                  <input
                    ref={lockInputRef}
                    className="input text-sm"
                    placeholder="Enter your username"
                    value={lockUsername}
                    onChange={(e) => setLockUsername(e.target.value)}
                    autoComplete="username"
                    aria-label="Locked form username"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
                  <PasswordInput
                    id="sale-lock-password-2"
                    className="text-sm"
                    placeholder="Enter your password"
                    value={lockPassword}
                    onChange={setLockPassword}
                    autoComplete="current-password"
                  />
                </div>
                {lockError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{lockError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={handleDiscardDraft} className="btn-secondary flex-1 text-sm">
                    Discard Draft
                  </button>
                  <button type="submit" disabled={lockLoading || !lockUsername.trim() || !lockPassword} className="btn-primary flex-1 text-sm flex items-center justify-center gap-1.5">
                    {lockLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    {lockLoading ? "Verifying..." : "Unlock"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-surface flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-ink">Register</h2>
          <span className="text-xs text-muted hidden sm:inline">Tap a product to add it to the sale</span>
          {isDraftRestored && !isLocked && draftSavedAt && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 hidden sm:inline">
              Draft restored from {formatDateTime(draftSavedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <BarcodeScanner
            onProductFound={(p) => {
              if (isLocked) return;
              if (p.is_serialized) { addToast("Serialized products can't be sold at checkout - create a shipment instead", "error"); return; }
              if (isSelectable(p)) addProduct(p); else addToast("Product has variants - scan a specific variant", "error");
            }}
            placeholder="Scan to add item..."
            autoFocus
          />
          <button
            type="button"
            onClick={isLocked ? () => { setLockUsername(""); setLockPassword(""); setLockError(""); } : handleLock}
            className={`p-2 rounded-lg border transition-colors ${isLocked ? "border-amber-300 dark:border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10" : "border-border text-muted hover:text-primary dark:hover:text-primary hover:border-primary"}`}
            aria-label={isLocked ? "Unlock form" : "Lock form"}
            title={isLocked ? "Form is locked" : "Lock form"}
          >
            {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
          <button type="button" onClick={handleClose} className="btn-secondary flex items-center gap-1.5" aria-label="Close register">
            <X size={16} />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 flex flex-col lg:flex-row overflow-hidden select-none">
        <section className="min-w-0 flex-1 flex flex-col overflow-hidden" aria-label="Product catalog">
          <div className="px-6 py-3 border-b border-border bg-surface space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                className="input pl-9"
                placeholder="Search products by name, SKU or barcode..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={formDisabled}
                aria-label="Search products"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  disabled={formDisabled}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${
                    category === c ? "bg-primary-solid text-white border-primary-solid" : "bg-surface border-border text-muted hover:border-primary"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0" viewportClassName="h-full p-6 sa-viewport-contain">
            {sellable.length === 0 ? (
              <EmptyState variant="block" icon={<PackageOpen size={48} />} title="No sellable products found" message="Mark a product as active to add it to a sale." />
            ) : visibleProducts.length === 0 ? (
              <EmptyState variant="block" icon={<Search size={48} />} title="No products match your search" message="Try a different product name or SKU." />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {visibleProducts.map((p) => {
                  const blocked = blockedProductIds.has(p.id);
                  const warned = warnedProductIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={formDisabled}
                      onClick={() => {
                        if (blocked) {
                          addToast(`'${p.display_name}' has a pending/failed quality check and can't be sold yet`, "error");
                          return;
                        }
                        addProduct(p);
                      }}
                      className={`text-left border rounded-xl p-4 bg-surface transition-colors relative ${
                        warned
                          ? "border-amber-300 dark:border-amber-500/40 hover:border-amber-400"
                          : "border-border hover:border-primary hover:shadow-sm"
                      } ${formDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {warned && (
                        <span className="absolute top-2 right-2" title="Quality check (pending/failed) — pick an unaffected fulfillment location">
                          <AlertTriangle size={14} className="text-amber-500" />
                        </span>
                      )}
                      <div className="h-28 mb-2 rounded-lg overflow-hidden bg-subtle flex items-center justify-center">
                        <img src={productImageUrl(p)} alt={p.display_name} className="w-full h-full object-cover" loading="lazy" onError={onImageError} />
                      </div>
                      <p className="font-semibold text-sm text-ink line-clamp-2">{p.display_name}</p>
                      <p className="text-xs text-faint mt-0.5">{p.sku}</p>
                      <p className="text-sm font-bold text-primary dark:text-primary mt-2">{formatCurrency(p.unit_price, currency)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </section>

        {isWide && (
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startResize}
            className="hidden lg:flex w-3.5 shrink-0 items-center justify-center cursor-col-resize bg-surface border-x border-border text-faint hover:text-primary hover:bg-primary-soft dark:hover:bg-primary-strong/40 transition-colors"
            style={{ touchAction: "none" }}
            title="Drag to resize"
          >
            <GripVertical size={14} />
          </div>
        )}

        <aside
          className="shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface flex flex-col h-[50vh] lg:h-auto overflow-y-auto lg:overflow-visible"
          style={{ width: isWide ? `${cartWidth}px` : undefined }}
          aria-label="Sale cart"
        >
          <div className="px-5 py-3 border-b border-border">
            <CartSwitcher
              carts={cartSummaries}
              activeId={activeCartId}
              disabled={formDisabled}
              onCreate={handleCreateCart}
              onSwitch={handleSwitchCart}
              onDelete={handleDeleteCart}
            />
          </div>
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-visible lg:overflow-hidden">
            <div className="px-5 py-4 border-b border-border space-y-3">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Customer</label>
                  <CustomerPicker
                    value={customerId ? parseInt(customerId) : null}
                    onChange={(id) => setCustomerId(id ? String(id) : "")}
                    disabled={formDisabled}
                  />
                  {customerId && (() => {
                    const c = customers.find((x) => String(x.id) === customerId);
                    if (!c?.group_name) return null;
                    return (
                      <p className="text-xs text-muted mt-1">
                        Group: <span className="font-medium text-ink">{c.group_name}</span>
                        {c.price_list_id ? " · Custom pricing active" : ""}
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Channel</label>
                  <FittedSelect
                    ariaLabel="Sales channel"
                    value={channelId}
                    onChange={setChannelId}
                    disabled={formDisabled}
                    options={[
                      { value: "", label: "Counter" },
                      ...channels.map((ch) => ({ value: String(ch.id), label: ch.name })),
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Payment</label>
                  <PaymentMethodPicker
                    method={paymentMethod}
                    provider={paymentProvider}
                    onSelect={(m, p) => { setPaymentMethod(m); setPaymentProvider(p ?? MOBILE_MONEY_PROVIDERS[0].value); }}
                    disabled={formDisabled}
                  />
                </div>
              </div>
              {paymentMethod === "mobile_money" && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Payer Phone</label>
                    <input className="input text-sm" placeholder="e.g. 07XX XXX XXX" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} disabled={formDisabled} aria-label="Payer phone" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Provider Amount ({currency})</label>
                    <input className="input text-sm" type="number" min="0" step="0.01" placeholder={total.toFixed(2)} value={paymentProviderAmount} onChange={(e) => setPaymentProviderAmount(e.target.value)} disabled={formDisabled} aria-label="Provider amount" />
                  </div>
                </>
              )}
              {paymentMethod !== "cash" && (
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Payment Reference</label>
                  <input className="input text-sm" placeholder={paymentMethod === "mobile_money" ? "Provider confirmation code" : "Reference (optional)"} value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} disabled={formDisabled} aria-label="Payment reference" />
                </div>
              )}
              <TextArea className="text-sm" rows={1} placeholder="Notes (optional)" value={notes} onChange={setNotes} disabled={formDisabled} ariaLabel="Sale notes" />
            </div>

            <ScrollArea className="flex-1 min-h-[8rem] lg:min-h-0" viewportClassName="h-full px-5 py-4 space-y-3 sa-viewport-contain">
              {items.length === 0 ? (
                <EmptyState variant="block" icon={<PackageOpen size={48} />} title="Cart is empty" message="Tap a product on the left to add it." />
              ) : (
                items.map((item, idx) => (
                  <CartLine
                    key={item.product_id}
                    item={item}
                    product={productById.get(parseInt(item.product_id))}
                    currency={currency}
                    blocked={isBlocked(item)}
                    disabled={formDisabled}
                    onShortChange={(short) => handleStockShort(item.product_id, short)}
                    onChange={(field, value) => updateItem(idx, field, value)}
                    onRemove={() => removeItem(idx)}
                  />
                ))
              )}
            </ScrollArea>

            <div className="px-5 py-4 border-t border-border space-y-3 bg-app">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Subtotal</span>
                <span>{formatCurrency(subtotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm gap-3 flex-wrap">
                <span className="text-muted shrink-0">Discount</span>
                <div className="relative flex-1 min-w-0 max-w-[160px]">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">{currency}</span>
                  <input
                    type="number"
                    className="input pl-6 py-1.5 text-sm"
                    placeholder="0.00"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    min="0"
                    step="0.01"
                    disabled={formDisabled}
                    aria-label="Discount amount"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm gap-3 flex-wrap">
                <span className="text-muted shrink-0">Promo Code</span>
                <div className="flex gap-2 flex-1 min-w-0 max-w-[240px]">
                  <input
                    type="text"
                    className="input py-1.5 text-sm font-mono flex-1"
                    placeholder="Code"
                    value={promoCode}
                    onChange={(e) => { setPromoCode(e.target.value); if (!e.target.value.trim()) { setPromoDiscount(0); setPromoError(""); } }}
                    onBlur={() => validatePromo()}
                    disabled={formDisabled}
                    aria-label="Promo code"
                  />
                  <button type="button" onClick={() => validatePromo()} disabled={formDisabled || promoValidating || !promoCode.trim()} className="btn-secondary text-xs px-2 py-1.5 disabled:opacity-40" aria-label="Apply promo code">
                    {promoValidating ? "..." : "Apply"}
                  </button>
                </div>
              </div>
              {promoError && <p className="text-xs text-red-600 dark:text-red-400">{promoError}</p>}
              {suggestedPromo && !promoCode.trim() && (
                <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Promo available: <span className="font-mono">{suggestedPromo.promo.code}</span>
                    </p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70 truncate">
                      {suggestedPromo.promo.description || `Save ${formatCurrency(suggestedPromo.discount, currency)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSuggestionDismissed(true)}
                      className="text-xs text-emerald-600/70 dark:text-emerald-400/60 hover:text-emerald-700 px-1.5 py-1"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPromoCode(suggestedPromo.promo.code);
                        validatePromo(suggestedPromo.promo.code);
                      }}
                      disabled={formDisabled}
                      className="text-xs font-medium bg-emerald-600 text-white px-2.5 py-1 rounded-md hover:bg-emerald-700 disabled:opacity-40"
                      aria-label="Apply suggested promo"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
              {effectivePromoDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Promo ({promoCode.trim().toUpperCase()})</span>
                  <span className="text-emerald-600 dark:text-emerald-400">-{formatCurrency(effectivePromoDiscount, currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted">Tax ({settings?.tax_rate ?? 0}%)</span>
                <span>{formatCurrency(tax, currency)}</span>
              </div>
              <div className="flex justify-between items-baseline border-t border-border pt-2">
                <span className="font-semibold">Total</span>
                {settings?.show_cart_summary_hover_cards !== false && items.length > 0 ? (
                  <HoverCard
                    width={300}
                    render={() => (
                      <CartSummaryCard
                        items={items}
                        productById={productById}
                        subtotal={subtotal}
                        discountAmount={discountAmount}
                        effectivePromoDiscount={effectivePromoDiscount}
                        promoCode={promoCode}
                        tax={tax}
                        total={total}
                        currency={currency}
                        payment={paymentLabel(paymentMethod, paymentProvider)}
                      />
                    )}
                  >
                    <span className="text-2xl font-bold text-ink">{formatCurrency(total, currency)}</span>
                  </HoverCard>
                ) : (
                  <span className="text-2xl font-bold text-ink">{formatCurrency(total, currency)}</span>
                )}
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
                    disabled={formDisabled}
                    aria-label="Cash received"
                  />
                  <button type="button" onClick={() => setAmountReceived(total.toFixed(2))} disabled={formDisabled} className="btn-secondary text-xs px-2 py-1.5 disabled:opacity-40" aria-label="Set received amount to exact total">Exact</button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[5, 10, 20, 50].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAmountReceived((cashReceived + n).toFixed(2))}
                      disabled={formDisabled}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted hover:bg-app disabled:opacity-40"
                      aria-label={`Add ${n} to received amount`}
                    >
                      +{n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-t border-border">
              <button type="submit" disabled={saving || formDisabled} className="btn-primary w-full py-3 text-base font-semibold disabled:opacity-40">
                {saving ? "Processing..." : `Complete Sale · ${formatCurrency(total, currency)}`}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
