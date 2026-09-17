import { useEffect, useState } from "react";
import api from "../api/client";
import type { Supplier } from "../types";
import { useToast } from "../context/ToastContext";
import SlideOver from "./SlideOver";
import TextArea from "./TextArea";
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
    }
  }, [supplier]);

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
            <TextArea rows={2} value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <TextArea rows={2} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
          </div>
        </div>

        {supplier && supplier.image_url && (
          <div className="rounded-xl border border-border bg-app p-4">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={entityImageUrl(supplier.image_url)}
                alt=""
                className="h-14 w-14 rounded-full object-cover border border-border bg-subtle shrink-0"
                loading="lazy"
                onError={onImageError}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">Profile Image</div>
                <p className="text-xs text-muted">Managed by the supplier in their portal.</p>
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
