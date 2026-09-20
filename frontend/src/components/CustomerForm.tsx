import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Customer, CustomerGroup, PaginatedResponse } from "../types";
import { useToast } from "../context/ToastContext";
import SlideOver from "./SlideOver";
import FittedSelect from "./FittedSelect";
import TextArea from "./TextArea";
import { errorMessage } from "../utils/errors";
import { entityImageUrl } from "../utils/images";
import { onImageError } from "../utils/placeholders";

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
  const [groupId, setGroupId] = useState(customer?.group_id != null ? String(customer.group_id) : "");
  const [notes, setNotes] = useState(customer?.notes || "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const { data: groups } = useQuery({
    queryKey: ["customer-groups"],
    queryFn: async () => {
      const { data } = await api.get("/customer-groups", { params: { limit: 200 } });
      return (data as PaginatedResponse<CustomerGroup>).items;
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name, phone, email, address, customer_type: customerType, notes };
      if (groupId) payload.group_id = Number(groupId);
      else payload.group_id = null;
      if (isEdit) {
        await api.put(`/customers/${customer!.id}`, payload);
        addToast("Customer updated", "success");
      } else {
        await api.post("/customers", payload);
        addToast("Customer created", "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, `Error ${isEdit ? "updating" : "creating"} customer`), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={isEdit ? "Edit Customer" : "New Customer"} wide ariaLabel={isEdit ? "Edit Customer" : "New Customer"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <TextArea rows={2} value={address} onChange={setAddress} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Customer Type</label>
              <FittedSelect
                ariaLabel="Customer Type"
                value={customerType}
                onChange={setCustomerType}
                options={[
                  { value: "frequent", label: "Frequent" },
                  { value: "walk-in", label: "Walk-in" },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Customer Group</label>
              <FittedSelect
                ariaLabel="Customer Group"
                value={groupId}
                onChange={setGroupId}
                options={[
                  { value: "", label: "No Group" },
                  ...(groups || []).map((g) => ({ value: String(g.id), label: g.name })),
                ]}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <TextArea rows={2} value={notes} onChange={setNotes} />
          </div>
        </div>

{customer?.image_url && (
          <div className="rounded-xl border border-border bg-app p-4">
            <div className="flex items-center gap-3">
              <img
                src={entityImageUrl(customer.image_url)}
                alt=""
                className="h-14 w-14 rounded-full object-cover border border-border bg-subtle shrink-0"
                loading="lazy"
                onError={onImageError}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">Profile Image</div>
                <p className="text-xs text-muted">Managed from this customer's portal.</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Customer" : "Create Customer")}
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
