import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import api from "../api/client";
import type { Order, Product, Supplier, Location } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import { isSelectable, selectableProducts, productLabel } from "../utils/variants";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";

interface Props {
  order?: Order;
  onClose: () => void;
  onSaved: () => void;
}

export default function OrderForm({ order, onClose, onSaved }: Props) {
  const isEdit = !!order;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [supplierId, setSupplierId] = useState(order?.supplier_id?.toString() || "");
  const [notes, setNotes] = useState(order?.notes || "");
  const [items, setItems] = useState(
    order?.items?.map((i) => ({ product_id: i.product_id.toString(), quantity: i.quantity.toString(), unit_price: i.unit_price.toString() })) || [{ product_id: "", quantity: "1", unit_price: "0" }]
  );
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  useEffect(() => {
    api.get("/suppliers").then(({ data }) => setSuppliers(data.items));
    api.get("/products", { params: { active_only: true, limit: 1000, include_variants: 1 } }).then(({ data }) => setProducts(data.items));
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
  }, []);

  const activeLocationIds = new Set(locations.filter((l) => l.is_active).map((l) => l.id));
  const hasActiveLocation = (p: Product) => !!p.location_id && activeLocationIds.has(p.location_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    for (const item of items) {
      const p = products.find((sp) => sp.id === parseInt(item.product_id));
      if (item.product_id && p && !hasActiveLocation(p)) {
        addToast(`${p.name} has no active location and cannot be ordered`, "error");
        setSaving(false);
        return;
      }
    }
    try {
      const payload = {
        supplier_id: supplierId ? parseInt(supplierId) : null,
        notes,
        items: items.map((i) => ({
          product_id: parseInt(i.product_id),
          quantity: parseInt(i.quantity) || 1,
          unit_price: parseFloat(i.unit_price) || 0,
        })),
      };
      if (isEdit) {
        await api.put(`/orders/${order!.id}`, payload);
        addToast("Order updated", "success");
      } else {
        await api.post("/orders", payload);
        addToast("Order created", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || `Error ${isEdit ? "updating" : "creating"} order`, "error");
    }
    setSaving(false);
  };

  const selectable = selectableProducts(products).filter(hasActiveLocation);

  const addItem = () => setItems([...items, { product_id: "", quantity: "1", unit_price: "0" }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: string, value: string) => {
    const updated = [...items];
    (updated[idx] as any)[field] = value;
    if (field === "product_id") {
      const p = selectable.find((p) => p.id === parseInt(value));
      if (p) updated[idx].unit_price = p.cost_price.toString();
    }
    setItems(updated);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Purchase Order" : "New Purchase Order"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
          <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-ink">Order Items</label>
            <div className="flex gap-2">
              <BarcodeScanner onProductFound={(p) => { if (!hasActiveLocation(p)) { addToast(`${p.name} has no active location and cannot be ordered`, "error"); return; } if (isSelectable(p)) setItems([...items, { product_id: p.id.toString(), quantity: "1", unit_price: p.cost_price.toString() }]); else addToast("Product has variants - scan a specific variant", "error"); }} placeholder="Scan to add item..." />
              <button type="button" onClick={addItem} className="btn-secondary text-xs py-1 px-2">
                Add Item
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <select
                    className="select text-sm"
                    value={item.product_id}
                    onChange={(e) => updateItem(idx, "product_id", e.target.value)}
                    required
                  >
                    <option value="">Select product</option>
                    {selectable.map((p) => (
                      <option key={p.id} value={p.id}>{productLabel(p)}{p.is_serialized ? " (Serialized)" : ""} ({formatCurrency(p.cost_price, currencySymbol)})</option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
                  <input type="number" className="input text-sm" placeholder="Qty" value={item.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)} min="1" required />
                </div>
                <div className="w-24">
                  <input type="number" className="input text-sm" placeholder="Price" value={item.unit_price}
                    onChange={(e) => updateItem(idx, "unit_price", e.target.value)} step="0.01" required />
                </div>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove item">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Order" : "Create Order")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
