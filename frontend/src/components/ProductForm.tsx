import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { Category, Location, Product, ProductImage, Supplier } from "../types";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../hooks/useSettings";
import SlideOver from "./SlideOver";
import LocationPicker from "./LocationPicker";
import { hasVariants } from "../utils/variants";
import { errorMessage } from "../utils/errors";

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
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<ProductImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
    api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } }).then(({ data }) => setLocations(data.items));
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
      if (product.images?.length) {
        setExistingImages(product.images);
        setImagePreviews(product.images.map((img) => img.url));
      } else if (product.image_url) {
        setExistingImages([{ id: 0, url: product.image_url, sort_order: 0 }]);
        setImagePreviews([product.image_url]);
      }
    } else if (parent) {
      setForm((f) => ({ ...f, sku: "", name: parent.name, category_id: parent.category_id?.toString() || "", supplier_id: parent.supplier_id?.toString() || "", location: parent.location || "" }));
    }
  }, [product, parent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const locationMatch = locations.find((l) => l.path === form.location.trim());
    let locationId: number | null = null;
    if (locationMatch) {
      locationId = locationMatch.id;
    } else if (product && form.location.trim() === (product.location || "").trim()) {
      locationId = product.location_id ?? null;
    }
    if (!locationId) {
      setError("Every product must be assigned to an active location.");
      setSaving(false);
      return;
    }
    let payload: Record<string, unknown> = {
      ...form,
      location_id: locationId,
      category_id: form.category_id ? Number(form.category_id) : null,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      unit_price: parseFloat(form.unit_price) || 0,
      cost_price: parseFloat(form.cost_price) || 0,
      quantity: parseInt(form.quantity) || 0,
      reorder_level: form.reorder_level === "" ? undefined : Math.max(0, parseInt(form.reorder_level) || 0),
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
        reorder_level: form.reorder_level === "" ? undefined : Math.max(0, parseInt(form.reorder_level) || 0),
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
      const allImagesRemoved = product && existingImages.length === 0 && imageFiles.length === 0 && (product.image_url || product.images?.length);
      const replacedLegacy = product && existingImages.length === 0 && imageFiles.length > 0 && product.image_url && !product.images?.length;
      if (allImagesRemoved || replacedLegacy) {
        payload.image_url = "";
      }
      if (product) {
        await api.put(`/products/${product.id}`, payload);
        addToast("Product updated", "success");
      } else {
        const { data } = await api.post("/products", payload);
        productId = data.id;
        addToast("Product created", "success");
      }
      if (productId) {
        for (const id of removedImageIds) {
          await api.delete(`/products/${productId}/images/${id}`).catch(() => {});
        }
        if (imageFiles.length > 0) {
          const fd = new FormData();
          imageFiles.forEach((f) => fd.append("files", f));
          await api.post(`/products/${productId}/images`, fd);
          addToast(imageFiles.length > 1 ? "Images uploaded" : "Image uploaded", "success");
        }
      }
      onSaved();
    } catch (err: any) {
      addToast(errorMessage(err, "Error saving product"), "error");
    }
    setSaving(false);
  };

  const field = (label: string, key: string, type = "text", required = false) => (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Category</label>
        <div className="input bg-app">{product?.category_name || parent?.category_name || "—"}</div>
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
        <div className="input bg-app">{product?.supplier_name || parent?.supplier_name || "—"}</div>
      </div>
    </div>
  );

  const setAttr = (idx: number, fieldKey: "key" | "value", value: string) => {
    setAttributes(attributes.map((a, i) => (i === idx ? { ...a, [fieldKey]: value } : a)));
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    setImageFiles((prev) => [...prev, ...arr]);
    const newPreviews = arr.map((f) => URL.createObjectURL(f));
    setImagePreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  const removeImage = useCallback((idx: number) => {
    if (idx < existingImages.length) {
      const img = existingImages[idx];
      if (img.id > 0) {
        setRemovedImageIds((prev) => [...prev, img.id]);
      }
      setExistingImages((prev) => prev.filter((_, i) => i !== idx));
      setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
    } else {
      const newIdx = idx - existingImages.length;
      setImageFiles((prev) => prev.filter((_, i) => i !== newIdx));
      setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
    }
  }, [existingImages]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  return (
    <SlideOver open onClose={onClose} title={product ? "Edit Product" : parent ? `Add Variant: ${parent.name}` : "Add Product"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("SKU *", "sku", "text", true)}
          {field("Name *", "name", "text", true)}
        </div>

        {isVariantMode && inheritedInfo}

        {!isVariantMode && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Description</label>
            <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        )}

        {!isVariantMode && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Category</label>
              <select className="select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
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
              <label className="block text-sm font-medium text-ink">Attributes</label>
              <button type="button" onClick={() => setAttributes([...attributes, { key: "", value: "" }])} className="btn-secondary text-xs py-1 px-2">
                <Plus size={14} className="inline mr-1" />Add Attribute
              </button>
            </div>
            {attributes.length === 0 && <p className="text-xs text-faint mb-1">No attributes yet. Add things like Color, Size, or Flavor.</p>}
            <div className="space-y-2">
              {attributes.map((a, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input className="input text-sm flex-1" placeholder="Attribute (e.g. Color)" value={a.key} onChange={(e) => setAttr(idx, "key", e.target.value)} />
                  <input className="input text-sm flex-1" placeholder="Value (e.g. Red)" value={a.value} onChange={(e) => setAttr(idx, "value", e.target.value)} />
                  <button type="button" onClick={() => setAttributes(attributes.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove attribute">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {field("Unit Price", "unit_price", "number")}
          {field("Cost Price", "cost_price", "number")}
          {isParentWithVariants ? (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
              <div className="input bg-app">{product?.total_quantity ?? product?.quantity ?? 0}</div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
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
          <p className="text-xs text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 rounded-lg px-3 py-2">
            Serialized products track stock per serial number. Quantity must be 0 — stock is added by recording receipts with serial numbers.
          </p>
        )}

        {isParentWithVariants && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
            Stock is held on this product's variants. Adjust quantities on individual variants.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Location *</label>
            <LocationPicker value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="e.g. A-01-B" />
            {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
          </div>
          {field("Barcode", "barcode")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("Batch Number", "batch_number")}
          {field("Expiry Date", "expiry_date", "date")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {!isVariantMode && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Serialized (tracked per unit)</label>
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
            <label className="block text-sm font-medium text-ink mb-1">Status</label>
            <select className="select" value={form.is_active ? "1" : "0"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "1" })}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Images</label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOver ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-border hover:border-indigo-400"}`}
          >
            <Upload size={20} className="mx-auto text-muted mb-1" />
            <p className="text-sm text-muted">Drag & drop images here or <span className="text-indigo-600 dark:text-indigo-400 font-medium">browse</span></p>
            <p className="text-xs text-faint mt-0.5">JPEG, PNG, GIF, WebP — max 10 MB each</p>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          </div>
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {imagePreviews.map((src, i) => (
                <div key={i} className="relative group">
                  <img src={src} alt="" className="w-16 h-16 rounded object-cover border border-border" />
                  <button type="button" onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove image">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : product ? "Update" : parent ? "Create Variant" : "Create"}
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
