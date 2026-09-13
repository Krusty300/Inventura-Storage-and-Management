import { useState } from "react";
import { Trash2, PackageX } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Order, Product, Supplier, Location } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import SlideOver from "./SlideOver";
import FittedSelect from "./FittedSelect";
import TextArea from "./TextArea";
import { isSelectable, selectableProducts, productLabel } from "../utils/variants";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";
import { useSettings } from "../hooks/useSettings";
import DatePicker from "./DatePicker";
import EmptyState from "./EmptyState";

interface Props {
  order?: Order;
  onClose: () => void;
  onSaved: () => void;
}

export default function OrderForm({ order, onClose, onSaved }: Props) {
  const isEdit = !!order;
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers", "picker"],
    queryFn: async () => (await api.get("/suppliers")).data.items,
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products", "selectable"],
    queryFn: async () => (await api.get("/products", { params: { active_only: true, limit: PAGE_SIZE_PRODUCTS, include_variants: 1 } })).data.items,
  });
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["locations", "lookup"],
    queryFn: async () => (await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } })).data.items,
  });
  const [supplierId, setSupplierId] = useState(order?.supplier_id?.toString() || "");
  const [notes, setNotes] = useState(order?.notes || "");
  const [expectedArrival, setExpectedArrival] = useState(order?.expected_arrival?.slice(0, 16) ?? "");
  const [items, setItems] = useState(
    order?.items?.map((i) => ({ product_id: i.product_id.toString(), quantity: i.quantity.toString(), unit_price: i.unit_price.toString() })) || [{ product_id: "", quantity: "1", unit_price: "0" }]
  );
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data: supplierProducts = [] } = useQuery<Product[]>({
    queryKey: ["supplier-products", supplierId],
    queryFn: async () => (await api.get(`/suppliers/${supplierId}/products`, { params: { limit: 100 } })).data.items,
    enabled: !!supplierId,
  });

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
        expected_arrival: expectedArrival || null,
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
    } catch (err: unknown) {
      addToast(errorMessage(err, `Error ${isEdit ? "updating" : "creating"} order`), "error");
    }
    setSaving(false);
  };

  const selectable = selectableProducts(products).filter(hasActiveLocation);

  const dropdownOptions = supplierId ? supplierOrderable : selectable;

  const addItem = () => setItems([...items, { product_id: "", quantity: "1", unit_price: "0" }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const alreadyAdded = (productId: number) => items.some((i) => i.product_id === productId.toString());

  type OrderItem = { product_id: string; quantity: string; unit_price: string };
  const updateItem = (idx: number, field: keyof OrderItem, value: string) => {
    if (field === "product_id" && value && alreadyAdded(parseInt(value))) {
      addToast("Product already added to this order", "error");
      return;
    }
    const updated = [...items];
    updated[idx][field] = value;
    if (field === "product_id") {
      const p = dropdownOptions.find((p) => p.id === parseInt(value));
      if (p) updated[idx].unit_price = p.cost_price.toString();
    }
    setItems(updated);
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title={isEdit ? `Edit ${order!.order_number}` : "New Purchase Order"}
      wide
      ariaLabel={isEdit ? `Edit order ${order!.order_number}` : "New Purchase Order"}
    >
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
          <FittedSelect
            ariaLabel="Supplier"
            value={supplierId}
            onChange={setSupplierId}
            options={[
              { value: "", label: "Select supplier" },
              ...suppliers.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>

        {supplierId && supplierOrderable.length === 0 && !supplierProducts.length && (
          <div className="border border-dashed border-border rounded-lg px-4 py-6">
            <EmptyState
              title="No orderable products"
              message="This supplier has no orderable products yet."
              icon={<PackageX size={48} />}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Expected Arrival</label>
          <DatePicker
            value={expectedArrival}
            onChange={setExpectedArrival}
            mode="datetime"
            ariaLabel="Expected Arrival"
          />
        </div>

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
                <div className="flex-1 min-w-0">
                  <FittedSelect
                    ariaLabel="Product"
                    value={item.product_id}
                    onChange={(v) => updateItem(idx, "product_id", v)}
                    options={[
                      { value: "", label: "Select product" },
                      ...dropdownOptions.map((p) => ({
                        value: String(p.id),
                        label: `${productLabel(p)}${p.is_serialized ? " (Serialized)" : ""} (${formatCurrency(p.cost_price, currencySymbol)})`,
                      })),
                    ]}
                  />
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
          <TextArea rows={2} ariaLabel="Notes" value={notes} onChange={setNotes} />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Order" : "Create Order")}
          </button>
        </div>
        </form>
      </div>
    </SlideOver>
  );
}
