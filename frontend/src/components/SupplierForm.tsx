import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2 } from "lucide-react";
import api from "../api/client";
import type { Supplier } from "../types";
import { useToast } from "../context/ToastContext";
import SlideOver from "./SlideOver";
import { errorMessage } from "../utils/errors";
import { entityImageUrl } from "../utils/images";
import { onImageError } from "../utils/placeholders";

interface Props {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function SupplierForm({ supplier, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>({
    name: "",
    contact_person: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    lead_time_days: "",
  });
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    if (supplier) {
      setForm({
        name: supplier.name,
        contact_person: supplier.contact_person,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address,
        notes: supplier.notes,
        lead_time_days: supplier.lead_time_days != null ? String(supplier.lead_time_days) : "",
      });
      setImageUrl(supplier.image_url || "");
    }
  }, [supplier]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supplier) return;
    const fd = new FormData();
    fd.append("file", file);
    setImageBusy(true);
    try {
      const { data } = await api.post(`/suppliers/${supplier.id}/upload-image`, fd);
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = data.image_url;
      });
      setImageUrl(data.image_url);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      addToast("Profile image updated", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to upload profile image"), "error");
    }
    setImageBusy(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const handleImageRemove = async () => {
    if (!supplier) return;
    try {
      await api.delete(`/suppliers/${supplier.id}/upload-image`);
      setImageUrl("");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      addToast("Profile image removed", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to remove profile image"), "error");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form };
    if (payload.lead_time_days === "") {
      payload.lead_time_days = "null";
    }
    const body = { ...payload, lead_time_days: payload.lead_time_days === "null" ? null : Number(payload.lead_time_days) };
    try {
      if (supplier) {
        await api.put(`/suppliers/${supplier.id}`, body);
        addToast("Supplier updated", "success");
      } else {
        await api.post("/suppliers", body);
        addToast("Supplier created", "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving supplier"), "error");
    }
    setSaving(false);
  };

  const field = (label: string, key: string) => (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key === "name"} />
    </div>
  );

  return (
    <SlideOver open onClose={onClose} title={supplier ? "Edit Supplier" : "Add Supplier"} wide ariaLabel={supplier ? "Edit Supplier" : "Add Supplier"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div className="text-xs font-medium text-muted uppercase tracking-wider">Basic info</div>
          {field("Name *", "name")}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field("Contact Person", "contact_person")}
            {field("Phone", "phone")}
          </div>
          {field("Email", "email")}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Lead Time (days)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={form.lead_time_days}
              onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })}
              placeholder="Used for safety stock &amp; reorder planning"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        {supplier && (
          <div className="rounded-xl border border-border bg-app p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={entityImageUrl(imageUrl)}
                  alt=""
                  className="h-14 w-14 rounded-full object-cover border border-border bg-subtle shrink-0"
                  loading="lazy"
                  onError={onImageError}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">Profile Image</div>
                  <p className="text-xs text-muted">Shown on this supplier's page, detail view, and hover cards.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageBusy} className="btn-secondary text-xs px-2.5 py-1.5 inline-flex items-center gap-1" aria-label="Upload profile image">
                  <Camera size={13} />{imageBusy ? "Uploading..." : "Upload"}
                </button>
                {imageUrl && (
                  <button type="button" onClick={handleImageRemove} className="btn-secondary text-xs px-2.5 py-1.5 inline-flex items-center gap-1" aria-label="Remove profile image">
                    <Trash2 size={13} />Remove
                  </button>
                )}
                <input ref={imageInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={handleImageUpload} />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : supplier ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
