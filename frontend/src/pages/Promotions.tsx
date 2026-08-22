import { useState } from "react";
import { Pencil, Trash2, Search, BadgePercent } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Promotion } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

export default function Promotions() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["promotions", debouncedSearch, page],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * 50).toString(), limit: "50" };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/promotions", { params });
      return data as PaginatedResponse<Promotion>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/promotions/${id}`),
    onSuccess: () => { addToast("Promotion deleted", "success"); queryClient.invalidateQueries({ queryKey: ["promotions"] }); },
    onError: (err: any) => { addToast(err.response?.data?.detail || "Cannot delete", "error"); },
  });

  const promotions = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Promotions</h1>
        {can("promotions.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">Add Promotion</button>
        )}
      </div>

      {isError && <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load promotions: {(error as any)?.message}</div>}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input className="input pl-10" placeholder="Search promotions..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search promotions" />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Promotions table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Code</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Discount</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Min Qty</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Min Amount</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Valid From</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Valid To</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Uses</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={9} />
              ) : promotions.length === 0 ? (
                <EmptyState title="No promotions" message="Create your first promotion to offer discounts." actionLabel="Add Promotion" onAction={() => { setEditing(null); setShowForm(true); }} />
              ) : promotions.map((p) => (
                <tr key={p.id} className="hover:bg-app">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <BadgePercent size={16} className="text-indigo-500" />
                      <span className="font-medium font-mono">{p.code}</span>
                    </div>
                    {p.description && <p className="text-xs text-muted mt-0.5 max-w-[200px] truncate">{p.description}</p>}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {p.discount_type === "percentage" ? `${p.value}%` : `$${p.value.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-3 text-muted">{p.min_qty || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.min_amount > 0 ? `$${p.min_amount.toFixed(2)}` : "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.valid_from || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.valid_to || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.max_uses > 0 ? `${p.used_count}/${p.max_uses}` : `${p.used_count}`}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.is_active ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400"}`}>
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {can("promotions.update") && <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${p.code}`}><Pencil size={16} /></button>}
                      {can("promotions.delete") && <button onClick={() => setDeleting(p)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${p.code}`}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.pages > 1 && <Pagination page={page} totalPages={data.pages} onPageChange={setPage} />}

      {showForm && <PromotionForm promotion={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["promotions"] }); }} />}
      {deleting && <ConfirmDialog open title="Delete Promotion" message={`Delete "${deleting.code}"? This cannot be undone.`} onConfirm={() => { deleteMutation.mutate(deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)} />}
    </div>
  );
}

function PromotionForm({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(promotion?.code || "");
  const [description, setDescription] = useState(promotion?.description || "");
  const [discountType, setDiscountType] = useState(promotion?.discount_type || "percentage");
  const [value, setValue] = useState(promotion?.value?.toString() || "");
  const [minQty, setMinQty] = useState(promotion?.min_qty?.toString() || "0");
  const [minAmount, setMinAmount] = useState(promotion?.min_amount?.toString() || "0");
  const [validFrom, setValidFrom] = useState(promotion?.valid_from || "");
  const [validTo, setValidTo] = useState(promotion?.valid_to || "");
  const [maxUses, setMaxUses] = useState(promotion?.max_uses?.toString() || "0");
  const [isActive, setIsActive] = useState(promotion?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        description,
        discount_type: discountType,
        value: parseFloat(value) || 0,
        min_qty: parseInt(minQty) || 0,
        min_amount: parseFloat(minAmount) || 0,
        valid_from: validFrom || null,
        valid_to: validTo || null,
        max_uses: parseInt(maxUses) || 0,
        is_active: isActive,
      };
      if (promotion) {
        await api.put(`/promotions/${promotion.id}`, body);
        addToast("Promotion updated", "success");
      } else {
        await api.post("/promotions", body);
        addToast("Promotion created", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving promotion", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={promotion ? "Edit Promotion" : "Add Promotion"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Code *</label>
          <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SAVE20" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Discount Type *</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="discount_type" value="percentage" checked={discountType === "percentage"} onChange={() => setDiscountType("percentage")} className="border-border-strong" />
              Percentage (%)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="discount_type" value="fixed" checked={discountType === "fixed"} onChange={() => setDiscountType("fixed")} className="border-border-strong" />
              Fixed Amount ($)
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Value *</label>
            <input type="number" step="0.01" min="0" className="input" value={value} onChange={(e) => setValue(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Max Uses (0 = unlimited)</label>
            <input type="number" min="0" className="input" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Min Qty (0 = no minimum)</label>
            <input type="number" min="0" className="input" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Min Amount (0 = no minimum)</label>
            <input type="number" step="0.01" min="0" className="input" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Valid From</label>
            <input type="date" className="input" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Valid To</label>
            <input type="date" className="input" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="rounded border-border-strong" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !code.trim()} className="btn-primary">{saving ? "Saving..." : promotion ? "Update" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
