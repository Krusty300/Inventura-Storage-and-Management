import { useEffect, useState } from "react";
import api from "../api/client";
import type { Supplier } from "../types";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";

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
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving supplier", "error");
    }
    setSaving(false);
  };

  const field = (label: string, key: string) => (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input className="input" value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key === "name"} />
    </div>
  );

  return (
    <Modal open onClose={onClose} title={supplier ? "Edit Supplier" : "Add Supplier"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {field("Name *", "name")}
        <div className="grid grid-cols-2 gap-4">
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
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Address</label>
          <textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : supplier ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
