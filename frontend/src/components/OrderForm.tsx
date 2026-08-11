import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Order, Product, Supplier, Location } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import { isSelectable, selectableProducts, productLabel } from "../utils/variants";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";
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
  const [supplierProducts, setSupplierProducts] = useState<Product[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<number>>(new Set());
  const [supplierProductsLoading, setSupplierProductsLoading] = useState(false);
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
    api.get("/products", { params: { active_only: true, limit: PAGE_SIZE_PRODUCTS, include_variants: 1 } }).then(({ data }) => setProducts(data.items));
    api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } }).then(({ data }) => setLocations(data.items));
  }, []);

  useEffect(() => {
    setSupplierProducts([]);
    setSelectedSupplierIds(new Set());
    if (!supplierId) return;
    let cancelled = false;
    setSupplierProductsLoading(true);
    api.get(`/suppliers/${supplierId}/products`, { params: { limit: 100 } })
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data?.items || []) as Product[];
        setSupplierProducts(rows);
        setSelectedSupplierIds(new Set(orderableSupplierProducts(rows).map((p) => p.id)));
      })
      .finally(() => { if (!cancelled) setSupplierProductsLoading(false); });
    return () => { cancelled = true; };
  }, [supplierId, locations]);

  const activeLocationIds = new Set(locations.filter((l) => l.is_active).map((l) => l.id));
  const hasActiveLocation = (p: Product) => !!p.location_id && activeLocationIds.has(p.location_id);

  const orderableSupplierProducts = (rows: Product[]): Product[] =>
    selectableProducts(rows).filter((p) => p.is_active && hasActiveLocation(p));

  const supplierOrderable = orderableSupplierProducts(supplierProducts);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    for (const item of items) {
      if (!item.product_id) {
        addToast("Every line item must have a product selected", "error");
        return;
      }
      const quantity = parseInt(item.quantity);
      if (isNaN(quantity) || quantity < 1) {
        addToast("Quantity must be at least 1 for every line item", "error");
        return;
      }
      const unitPrice = parseFloat(item.unit_price);
      if (isNaN(unitPrice) || unitPrice < 0) {
        addToast("Price cannot be negative for any line item", "error");
        return;
      }
      const p = products.find((sp) => sp.id === parseInt(item.product_id));
      if (p && !hasActiveLocation(p)) {
        addToast(`${p.name} has no active location and cannot be ordered`, "error");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId ? parseInt(supplierId) : null,
        notes,
        items: items.map((i) => ({
          product_id: parseInt(i.product_id),
          quantity: parseInt(i.quantity),
          unit_price: parseFloat(i.unit_price),
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
      addToast(errorMessage(err, `Error ${isEdit ? "updating" : "creating"} order`), "error");
    }
    setSaving(false);
  };

  const selectable = selectableProducts(products).filter(hasActiveLocation);

  const dropdownOptions = supplierId ? supplierOrderable : selectable;

  const allSupplierSelected = supplierOrderable.length > 0 && supplierOrderable.every((p) => selectedSupplierIds.has(p.id));

  const addSelectedSupplierItems = () => {
    const toAdd = supplierOrderable.filter((p) => selectedSupplierIds.has(p.id) && !alreadyAdded(p.id));
    if (toAdd.length === 0) {
      addToast(selectedSupplierIds.size > 0 ? "Selected product(s) already in this order" : "No supplier products selected", "error");
      return;
    }
    setItems((prev) => [...prev, ...toAdd.map((p) => ({ product_id: p.id.toString(), quantity: "1", unit_price: p.cost_price.toString() }))]);
    setSelectedSupplierIds(new Set());
    addToast(`${toAdd.length} product(s) added from supplier`, "success");
  };

  const addItem = () => setItems([...items, { product_id: "", quantity: "1", unit_price: "0" }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const alreadyAdded = (productId: number) => items.some((i) => i.product_id === productId.toString());

  const updateItem = (idx: number, field: string, value: string) => {
    if (field === "product_id" && value && alreadyAdded(parseInt(value))) {
      addToast("Product already added to this order", "error");
      return;
    }
    const updated = [...items];
    (updated[idx] as any)[field] = value;
    if (field === "product_id") {
      const p = dropdownOptions.find((p) => p.id === parseInt(value));
      if (p) updated[idx].unit_price = p.cost_price.toString();
    }
    setItems(updated);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Purchase Order" : "New Purchase Order"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
          <select className="select" aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {supplierId && (
          <div className="border border-border rounded-lg p-3 bg-app">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <label className="text-sm font-medium text-ink">Supplier Products</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-border-strong"
                    checked={allSupplierSelected}
                    onChange={(e) => setSelectedSupplierIds(e.target.checked ? new Set(supplierOrderable.map((p) => p.id)) : new Set())}
                    aria-label="Select all supplier products"
                  />
                  Select all
                </label>
                <button type="button" onClick={addSelectedSupplierItems} className="btn-primary text-xs py-1 px-2">
                  Add Selected Items
                </button>
              </div>
            </div>
            {supplierProductsLoading ? (
              <p className="text-faint text-sm">Loading supplier products...</p>
            ) : supplierOrderable.length === 0 ? (
              <p className="text-faint text-sm">No orderable products found for this supplier.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-auto">
                {supplierOrderable.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-border-strong"
                      checked={selectedSupplierIds.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(selectedSupplierIds);
                        if (e.target.checked) next.add(p.id); else next.delete(p.id);
                        setSelectedSupplierIds(next);
                      }}
                      aria-label={`Add ${p.display_name} to order`}
                    />
                    <span className="flex-1">{productLabel(p)}</span>
                    <span className="text-muted">{formatCurrency(p.cost_price, currencySymbol)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-ink">Order Items</label>
            <div className="flex gap-2">
              <BarcodeScanner onProductFound={(p) => { if (!hasActiveLocation(p)) { addToast(`${p.name} has no active location and cannot be ordered`, "error"); return; } if (alreadyAdded(p.id)) { addToast("Product already added to this order", "error"); return; } if (isSelectable(p)) setItems([...items, { product_id: p.id.toString(), quantity: "1", unit_price: p.cost_price.toString() }]); else addToast("Product has variants - scan a specific variant", "error"); }} placeholder="Scan to add item..." />
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
                    {dropdownOptions.map((p) => (
                      <option key={p.id} value={p.id}>{productLabel(p)}{p.is_serialized ? " (Serialized)" : ""} ({formatCurrency(p.cost_price, currencySymbol)})</option>
                    ))}
                  </select>
                </div>
                <div className="w-16 sm:w-20">
                  <input type="number" className="input text-sm" placeholder="Qty" value={item.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)} min="1" required />
                </div>
                <div className="w-20 sm:w-24">
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
