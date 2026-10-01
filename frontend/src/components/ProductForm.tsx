import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { Category, Location, MenuSection, Product, ProductImage, Supplier } from "../types";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../hooks/useSettings";
import SlideOver from "./SlideOver";
import FittedSelect from "./FittedSelect";
import TextArea from "./TextArea";
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

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

export default function ProductForm({ product, parent, onClose, onSaved }: Props) {
  const isVariantMode = !!product?.is_variant || !!parent;
  const isParentWithVariants = !!product && !product.is_variant && hasVariants(product);
  const [form, setForm] = useState({
    sku: "", name: "", description: "", category_id: "", supplier_id: "",
    unit_price: "0", cost_price: "0", quantity: "0", reorder_level: "",
    location: "", barcode: "", batch_number: "", expiry_date: "", is_active: true,
    is_serialized: false,
    is_menu_item: false,
    menu_section_id: "",
  });
  const [attributes, setAttributes] = useState<AttrRow[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<ProductImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formInitRef = useRef(false);
  const createdUrlsRef = useRef<string[]>([]);
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => (await api.get("/categories")).data.items,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers", "picker"],
    queryFn: async () => (await api.get("/suppliers")).data.items,
  });
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["locations", "lookup"],
    queryFn: async () => (await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } })).data.items,
  });
  const { data: menuSections = [] } = useQuery<MenuSection[]>({
    queryKey: ["restaurant-menu-sections", "lookup"],
    queryFn: async () => (await api.get("/restaurant/menu-sections")).data,
  });
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
    if (formInitRef.current) return;
    if (product) {
      formInitRef.current = true;
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
        is_menu_item: product.is_menu_item ?? false,
        menu_section_id: product.menu_section_id?.toString() || "",
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
      formInitRef.current = true;
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
      menu_section_id: form.menu_section_id ? Number(form.menu_section_id) : null,
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
          await api.delete(`/products/${productId}/images/${id}`).catch((err) => {
            if (err?.response?.status !== 404) console.error("Failed to delete image", err);
          });
        }
        if (imageFiles.length > 0) {
          const fd = new FormData();
          imageFiles.forEach((f) => fd.append("files", f));
          try {
            await api.post(`/products/${productId}/images`, fd);
            addToast(imageFiles.length > 1 ? "Images uploaded" : "Image uploaded", "success");
          } catch {
            addToast("Product saved, but the image upload failed. You can retry from the product page.", "error");
          }
        }
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving product"), "error");
    }
    setSaving(false);
  };

  const field = (label: string, key: Exclude<keyof typeof form, "is_active" | "is_serialized" | "is_menu_item">, type = "text", required = false) => (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input
        type={type}
        className="input"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        required={required}
      />
    </div>
  );

  const inheritedInfo = (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
      <div>
        <p className={`${sectionLabel} mb-1`}>Category</p>
        <p className="text-sm text-ink">{product?.category_name || parent?.category_name || "—"}</p>
      </div>
      <div>
        <p className={`${sectionLabel} mb-1`}>Supplier</p>
        <p className="text-sm text-ink">{product?.supplier_name || parent?.supplier_name || "—"}</p>
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
    createdUrlsRef.current.push(...newPreviews);
    setImagePreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  // Release any preview object URLs left when the form unmounts.
  useEffect(() => {
    const urls = createdUrlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const removeImage = useCallback((idx: number) => {
    if (idx < existingImages.length) {
      const img = existingImages[idx];
      if (img.id > 0) {
        setRemovedImageIds((prev) => [...prev, img.id]);
      }
      setExistingImages((prev) => prev.filter((_, i) => i !== idx));
      setImagePreviews((prev) => {
        const url = prev[idx];
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        return prev.filter((_, i) => i !== idx);
      });
    } else {
      const newIdx = idx - existingImages.length;
      setImageFiles((prev) => prev.filter((_, i) => i !== newIdx));
      setImagePreviews((prev) => {
        const url = prev[idx];
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        return prev.filter((_, i) => i !== idx);
      });
    }
  }, [existingImages]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const docTitle = product ? `Edit ${product.sku ? `${product.sku}: ` : ""}${product.name}` : parent ? `Add Variant: ${parent.name}` : "New Product";

  return (
    <SlideOver open onClose={onClose} title={product ? "Edit Product" : parent ? `Add Variant: ${parent.name}` : "Add Product"} wide>
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <p className={sectionLabel}>{product ? "Edit Product" : parent ? "Add Variant" : "New Product"}</p>
            <p className="text-xl font-bold text-ink mt-0.5 tracking-tight">{docTitle}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-0">
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>General Information</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field("SKU *", "sku", "text", true)}
              {field("Name *", "name", "text", true)}
            </div>

            {isVariantMode && <div className="mt-4">{inheritedInfo}</div>}

            {!isVariantMode && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-ink mb-1">Description</label>
                <TextArea rows={2} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
              </div>
            )}

            {!isVariantMode && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Category</label>
                  <FittedSelect
                    ariaLabel="Category"
                    value={form.category_id}
                    onChange={(v) => setForm({ ...form, category_id: v })}
                    options={[
                      { value: "", label: "None" },
                      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
                  <FittedSelect
                    ariaLabel="Supplier"
                    value={form.supplier_id}
                    onChange={(v) => setForm({ ...form, supplier_id: v })}
                    options={[
                      { value: "", label: "None" },
                      ...suppliers.map((s) => ({ value: String(s.id), label: s.name })),
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          {isVariantMode && (
            <div className="px-6 py-5 border-b border-dashed border-border">
              <p className={`${sectionLabel} mb-3`}>Attributes</p>
              <div className="flex items-center justify-between mb-2">
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

          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>Pricing &amp; Stock</p>
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
              <p className="text-xs text-primary-strong dark:text-primary bg-primary-soft dark:bg-primary/10 border border-primary-soft dark:border-primary/30 rounded-lg px-3 py-2 mt-4">
                Serialized products track stock per serial number. Quantity must be 0 — stock is added by recording receipts with serial numbers.
              </p>
            )}

            {isParentWithVariants && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 mt-4">
                Stock is held on this product's variants. Adjust quantities on individual variants.
              </p>
            )}
          </div>

          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>Location &amp; Tracking</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Location *</label>
                <LocationPicker value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="e.g. A-01-B" />
                {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
              </div>
              {field("Barcode", "barcode")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {field("Batch Number", "batch_number")}
              {field("Expiry Date", "expiry_date", "date")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {!isVariantMode && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Serialized (tracked per unit)</label>
                  <FittedSelect
                    value={form.is_serialized ? "1" : "0"}
                    onChange={(v) => setForm({ ...form, is_serialized: v === "1", quantity: "0" })}
                    disabled={isParentWithVariants || isVariantMode}
                    ariaLabel="Serialized (tracked per unit)"
                    options={[
                      { value: "0", label: "No" },
                      { value: "1", label: "Yes" },
                    ]}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Status</label>
                <FittedSelect
                  ariaLabel="Status"
                  value={form.is_active ? "1" : "0"}
                  onChange={(val) => setForm({ ...form, is_active: val === "1" })}
                  options={[
                    { value: "1", label: "Active" },
                    { value: "0", label: "Inactive" },
                  ]}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Menu item (restaurant POS)</label>
                <FittedSelect
                  ariaLabel="Menu item (restaurant POS)"
                  value={form.is_menu_item ? "1" : "0"}
                  onChange={(v) => setForm({ ...form, is_menu_item: v === "1" })}
                  disabled={form.is_serialized}
                  options={[
                    { value: "0", label: "No" },
                    { value: "1", label: "Yes" },
                  ]}
                />
                {form.is_serialized && (
                  <p className="text-xs text-muted mt-1">Serialized products can't be menu items.</p>
                )}
              </div>
              {form.is_menu_item && !form.is_serialized && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Menu section</label>
                  <FittedSelect
                    ariaLabel="Menu section"
                    value={form.menu_section_id}
                    onChange={(v) => setForm({ ...form, menu_section_id: v })}
                    options={[
                      { value: "", label: "Uncategorized" },
                      ...menuSections.map((s) => ({ value: s.id.toString(), label: s.name })),
                    ]}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            <p className={`${sectionLabel} mb-3`}>Images</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary-soft dark:bg-primary/10" : "border-border hover:border-primary"}`}
            >
              <Upload size={20} className="mx-auto text-muted mb-1" />
              <p className="text-sm text-muted">Drag & drop images here or <span className="text-primary dark:text-primary font-medium">browse</span></p>
              <p className="text-xs text-faint mt-0.5">JPEG, PNG, GIF, WebP — max 10 MB each</p>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {imagePreviews.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {imagePreviews.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} alt="" className="w-16 h-16 rounded object-cover border border-border" />
                    <button type="button" onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 h-7 w-7 inline-flex items-center justify-center rounded-full bg-red-500 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" aria-label="Remove image">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving..." : product ? "Update" : parent ? "Create Variant" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </SlideOver>
  );
}
