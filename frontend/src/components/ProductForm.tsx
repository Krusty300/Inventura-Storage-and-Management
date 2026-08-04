import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import api from "../api/client";
import type { Category, Location, Product, Supplier } from "../types";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../hooks/useSettings";
import Modal from "./Modal";
import LocationPicker from "./LocationPicker";
import { hasVariants } from "../utils/variants";

interface Props {
  product: Product | null;
  parent?: Product | null;
  onClose: () => void;
  onSaved: () => void;
}

interface AttrRow {
  key: string;
  value: string;
}

export default function ProductForm({ product, parent, onClose, onSaved }: Props) {
  const isVariantMode = !!product?.is_variant || !!parent;
  const isParentWithVariants = !!product && !product.is_variant && hasVariants(product);
  const [form, setForm] = useState({
    sku: "", name: "", description: "", category_id: "", supplier_id: "",
    unit_price: "0", cost_price: "0", quantity: "0", reorder_level: "",
    location: "", barcode: "", batch_number: "", expiry_date: "", is_active: true,
    is_serialized: false,
  });
  const [attributes, setAttributes] = useState<AttrRow[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { data: settings } = useSettings();

  useEffect(() => {
    if (!product && settings?.default_reorder_level != null && form.reorder_level === "") {
      setForm((f) => ({ ...f, reorder_level: String(settings.default_reorder_level) }));
    }
  }, [product, settings, form.reorder_level]);

  useEffect(() => {
    api.get("/categories").then(({ data }) => setCategories(data.items));
    api.get("/suppliers").then(({ data }) => setSuppliers(data.items));
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
    if (product) {
      setForm({
        sku: product.sku, name: product.name, description: product.description,
        category_id: product.category_id?.toString() || "",
        supplier_id: product.supplier_id?.toString() || "",
        unit_price: product.unit_price.toString(),
        cost_price: product.cost_price.toString(),
        quantity: product.quantity.toString(),
        reorder_level: product.reorder_level.toString(),
        location: product.location, barcode: product.barcode,
        batch_number: product.batch_number || "",
        expiry_date: product.expiry_date ? product.expiry_date.slice(0, 10) : "",
        is_active: product.is_active,
        is_serialized: product.is_serialized,
      });
      setAttributes(product.attributes ? Object.entries(product.attributes).map(([key, value]) => ({ key, value })) : []);
      if (product.image_url) setImagePreview(product.image_url);
    } else if (parent) {
      setForm((f) => ({ ...f, sku: "", name: parent.name, category_id: parent.category_id?.toString() || "", supplier_id: parent.supplier_id?.toString() || "" }));
    }
  }, [product, parent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const locationMatch = locations.find((l) => l.path === form.location.trim());
    const locationId = locationMatch ? locationMatch.id : (product ? product.location_id ?? null : null);
    let payload: Record<string, unknown> = {
      ...form,
      location_id: locationId,
      category_id: form.category_id ? Number(form.category_id) : null,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      unit_price: parseFloat(form.unit_price) || 0,
      cost_price: parseFloat(form.cost_price) || 0,
      quantity: parseInt(form.quantity) || 0,
      reorder_level: form.reorder_level === "" ? undefined : parseInt(form.reorder_level) || 10,
      expiry_date: form.expiry_date || null,
    };
    if (isVariantMode) {
      const attrs: Record<string, string> = {};
      attributes.filter((a) => a.key.trim()).forEach((a) => { attrs[a.key.trim()] = a.value; });
      payload = {
        name: form.name.trim(),
        sku: form.sku,
        attributes: attrs,
        location_id: locationId,
        unit_price: parseFloat(form.unit_price) || 0,
        cost_price: parseFloat(form.cost_price) || 0,
        quantity: parseInt(form.quantity) || 0,
        reorder_level: form.reorder_level === "" ? undefined : parseInt(form.reorder_level) || 10,
        location: form.location, barcode: form.barcode,
        batch_number: form.batch_number || "",
        expiry_date: form.expiry_date || null,
        is_active: form.is_active,
      };
      if (parent) payload.parent_id = parent.id;
    } else if (isParentWithVariants) {
      delete payload.quantity;
    }
    try {
      let productId = product?.id;
      if (product) {
        await api.put(`/products/${product.id}`, payload);
        addToast("Product updated", "success");
      } else {
        const { data } = await api.post("/products", payload);
        productId = data.id;
        addToast("Product created", "success");
      }
      if (imageFile && productId) {
        const fd = new FormData();
        fd.append("file", imageFile);
        await api.post(`/products/${productId}/upload-image`, fd);
        addToast("Image uploaded", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving product", "error");
    }
    setSaving(false);
  };

  const field = (label: string, key: string, type = "text", required = false) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        className="input"
        value={(form as any)[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        required={required}
      />
    </div>
  );

  const inheritedInfo = (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
        <div className="input bg-gray-50">{product?.category_name || parent?.category_name || "—"}</div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
        <div className="input bg-gray-50">{product?.supplier_name || parent?.supplier_name || "—"}</div>
      </div>
    </div>
  );

  const setAttr = (idx: number, fieldKey: "key" | "value", value: string) => {
    setAttributes(attributes.map((a, i) => (i === idx ? { ...a, [fieldKey]: value } : a)));
  };

  return (
    <Modal open onClose={onClose} title={product ? "Edit Product" : parent ? `Add Variant: ${parent.name}` : "Add Product"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {field("SKU *", "sku", "text", true)}
          {field("Name *", "name", "text", true)}
        </div>

        {isVariantMode && inheritedInfo}

        {!isVariantMode && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        )}

        {!isVariantMode && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select className="select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select className="select" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">None</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {isVariantMode && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Attributes</label>
              <button type="button" onClick={() => setAttributes([...attributes, { key: "", value: "" }])} className="btn-secondary text-xs py-1 px-2">
                <Plus size={14} className="inline mr-1" />Add Attribute
              </button>
            </div>
            {attributes.length === 0 && <p className="text-xs text-gray-400 mb-1">No attributes yet. Add things like Color, Size, or Flavor.</p>}
            <div className="space-y-2">
              {attributes.map((a, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input className="input text-sm flex-1" placeholder="Attribute (e.g. Color)" value={a.key} onChange={(e) => setAttr(idx, "key", e.target.value)} />
                  <input className="input text-sm flex-1" placeholder="Value (e.g. Red)" value={a.value} onChange={(e) => setAttr(idx, "value", e.target.value)} />
                  <button type="button" onClick={() => setAttributes(attributes.filter((_, i) => i !== idx))} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove attribute">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4">
          {field("Unit Price", "unit_price", "number")}
          {field("Cost Price", "cost_price", "number")}
          {isParentWithVariants ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <div className="input bg-gray-50">{product?.total_quantity ?? product?.quantity ?? 0}</div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                className="input"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                disabled={form.is_serialized}
              />
            </div>
          )}
          {field("Reorder Level", "reorder_level", "number")}
        </div>

        {!isVariantMode && form.is_serialized && (
          <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            Serialized products track stock per serial number. Quantity must be 0 — stock is added by recording receipts with serial numbers.
          </p>
        )}

        {isParentWithVariants && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Stock is held on this product's variants. Adjust quantities on individual variants.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <LocationPicker value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="e.g. A-01-B" />
          </div>
          {field("Barcode", "barcode")}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {field("Batch Number", "batch_number")}
          {field("Expiry Date", "expiry_date", "date")}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {!isVariantMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Serialized (tracked per unit)</label>
              <select
                className="select"
                value={form.is_serialized ? "1" : "0"}
                onChange={(e) => setForm({ ...form, is_serialized: e.target.value === "1", quantity: "0" })}
                disabled={isParentWithVariants || isVariantMode}
              >
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select className="select" value={form.is_active ? "1" : "0"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "1" })}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Image</label>
          <div className="flex items-center gap-4">
            {imagePreview && <img src={imagePreview} alt="" className="w-16 h-16 rounded object-cover border" />}
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImageFile(f); setImagePreview(URL.createObjectURL(f)); } }} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : product ? "Update" : parent ? "Create Variant" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
