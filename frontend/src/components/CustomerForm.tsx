import { useState } from "react";
import api from "../api/client";
import type { Customer } from "../types";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";

interface Props {
  customer?: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CustomerForm({ customer, onClose, onSaved }: Props) {
  const isEdit = !!customer;
  const [name, setName] = useState(customer?.name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [email, setEmail] = useState(customer?.email || "");
  const [address, setAddress] = useState(customer?.address || "");
  const [customerType, setCustomerType] = useState(customer?.customer_type || "walk-in");
  const [notes, setNotes] = useState(customer?.notes || "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name, phone, email, address, customer_type: customerType, notes };
      if (isEdit) {
        await api.put(`/customers/${customer!.id}`, payload);
        addToast("Customer updated", "success");
      } else {
        await api.post("/customers", payload);
        addToast("Customer created", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || `Error ${isEdit ? "updating" : "creating"} customer`, "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Customer" : "New Customer"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Phone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Address</label>
          <textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Customer Type</label>
          <select className="select" value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
            <option value="frequent">Frequent</option>
            <option value="walk-in">Walk-in</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Customer" : "Create Customer")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
