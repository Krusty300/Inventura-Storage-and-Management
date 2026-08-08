import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import api from "../api/client";
import type { Customer, Product, Settings } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { formatCurrency } from "../utils/currency";
import { isSelectable, selectableProducts, productLabel } from "../utils/variants";

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

const EMPTY_ITEM: LineItem = { product_id: "", quantity: "1", unit_price: "0", location_id: "" };

interface SaleItemRowProps {
  item: LineItem;
  idx: number;
  sellable: Product[];
  currency: string;
  canRemove: boolean;
  onChange: (idx: number, field: string, value: string) => void;
  onRemove: (idx: number) => void;
}

function SaleItemRow({ item, idx, sellable, currency, canRemove, onChange, onRemove }: SaleItemRowProps) {
  const product = sellable.find((p) => p.id === parseInt(item.product_id));
  const { locations: stockLocations, isLoading: stockLoading } = useProductStockLocations(product?.id, false);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end border border-border rounded-lg p-3">
      <div className="sm:col-span-4">
        <label className="block text-xs font-medium text-muted mb-1.5">Product</label>
        <select className="select text-sm" value={item.product_id} onChange={(e) => onChange(idx, "product_id", e.target.value)} required>
          <option value="">Select product</option>
          {sellable.map((p) => (
            <option key={p.id} value={p.id}>{productLabel(p)} ({formatCurrency(p.unit_price, currency)})</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
          Fulfill from
          {stockLoading && <Loader2 size={10} className="animate-spin" />}
        </label>
        <select
          className="select text-sm"
          value={item.location_id}
          onChange={(e) => onChange(idx, "location_id", e.target.value)}
          disabled={!product}
          aria-label="Fulfill from location"
        >
          <option value="">Auto (any location)</option>
          {stockLocations.map((l) => (
            <option key={l.location_id} value={l.location_id.toString()}>{l.path} ({l.count})</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-muted mb-1.5">Qty</label>
        <input type="number" className="input text-sm" placeholder="Qty" value={item.quantity} onChange={(e) => onChange(idx, "quantity", e.target.value)} min="1" required />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-muted mb-1.5">Price</label>
        <input type="number" className="input text-sm" placeholder="Price" value={item.unit_price} onChange={(e) => onChange(idx, "unit_price", e.target.value)} step="0.01" required />
      </div>
      <div className="sm:col-span-1 flex justify-end">
        {canRemove && (
          <button type="button" onClick={() => onRemove(idx)} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove item">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function SaleForm({ onClose, onSaved }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    api.get("/customers", { params: { limit: 1000 } }).then(({ data }) => setCustomers(data.items));
    api.get("/products", { params: { active_only: true, limit: 1000, include_variants: 1 } }).then(({ data }) => setProducts(data.items));
    api.get("/settings").then(({ data }) => setSettings(data));
  }, []);

  const selectable = selectableProducts(products);
  const sellable = selectable.filter((p) => !p.is_serialized);

  const addItem = () => setItems([...items, { ...EMPTY_ITEM }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: string, value: string) => {
    const updated = [...items];
    (updated[idx] as any)[field] = value;
    if (field === "product_id") {
      const p = sellable.find((x) => x.id === parseInt(value));
      if (p) updated[idx].unit_price = p.unit_price.toString();
      updated[idx].location_id = "";
    }
    setItems(updated);
  };

  const subtotal = items.reduce((sum, i) => sum + (parseInt(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const tax = settings ? subtotal * settings.tax_rate / 100 : 0;
  const total = subtotal + tax;
  const currency = settings?.currency_symbol || "$";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.some((i) => !i.product_id)) {
      addToast("All line items must have a product selected", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/sales", {
        customer_id: customerId ? parseInt(customerId) : null,
        payment_method: paymentMethod,
        notes,
        items: items.map((i) => ({
          product_id: parseInt(i.product_id),
          quantity: parseInt(i.quantity) || 1,
          unit_price: parseFloat(i.unit_price) || 0,
          location_id: i.location_id ? parseInt(i.location_id) : null,
        })),
      });
      addToast("Sale completed", "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error processing sale", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="New Sale" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Customer</label>
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select a customer (walk-in)</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Payment Method</label>
            <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <label className="text-sm font-medium text-ink">Items</label>
            <div className="flex gap-2 flex-wrap justify-end">
              <BarcodeScanner onProductFound={(p) => {
                if (p.is_serialized) { addToast("Serialized products can't be sold at checkout - create a shipment instead", "error"); return; }
                if (isSelectable(p)) setItems([...items, { product_id: p.id.toString(), quantity: "1", unit_price: p.unit_price.toString(), location_id: "" }]); else addToast("Product has variants - scan a specific variant", "error");
              }} placeholder="Scan to add item..." />
              <button type="button" onClick={addItem} className="btn-secondary text-xs py-1 px-2">
                Add Item
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <SaleItemRow
                key={idx}
                item={item}
                idx={idx}
                sellable={sellable}
                currency={currency}
                canRemove={items.length > 1}
                onChange={updateItem}
                onRemove={removeItem}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatCurrency(subtotal, currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax ({settings?.tax_rate ?? 0}%)</span><span>{formatCurrency(tax, currency)}</span></div>
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(total, currency)}</span></div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Processing..." : `Complete Sale (${formatCurrency(total, currency)})`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
