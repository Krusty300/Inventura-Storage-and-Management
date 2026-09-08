import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Boxes, Eye, Layers, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { BOM, PaginatedResponse, ProductCost } from "../types";
import SlideOver from "../components/SlideOver";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import ErrorState from "../components/ErrorState";
import FittedSelect from "../components/FittedSelect";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";

export default function Boms() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BOM | null>(null);
  const [viewing, setViewing] = useState<BOM | null>(null);
  const [deleting, setDeleting] = useState<BOM | null>(null);
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["boms", debouncedSearch, includeInactive, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (!includeInactive) params.is_active = "true";
      const { data } = await api.get("/boms", { params });
      return data as PaginatedResponse<BOM>;
    },
  });

  const boms = data?.items || [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/boms/${id}`),
    onSuccess: () => {
      addToast("BOM deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["boms"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete BOM"), "error");
    },
    onSettled: () => setDeleting(null),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["boms"] });

  const openNew = () => { setEditing(null); setShowForm(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Boxes size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink tracking-tight">Bills of Materials</h1>
            <p className="text-sm text-muted mt-0.5">Define how products are built from their component parts.</p>
          </div>
        </div>
        {can("bom.create") && (
          <button onClick={openNew} className="btn-primary shrink-0">
            <Plus size={16} /> New BOM
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by BOM name, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search BOMs" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-primary"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
          />
          Show inactive
        </label>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="BOMs table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">BOM</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Output Product</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Components</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Total Cost</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Updated</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : isError ? (
              <ErrorState onRetry={refresh} />
            ) : boms.length === 0 ? (
              <EmptyState title="No BOMs yet" message="Create a bill of materials to define how a product is manufactured." actionLabel="New BOM" onAction={openNew} />
            ) : boms.map((b) => (
              <tr key={b.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(b)}>
                <td className="px-4 py-3 font-medium">{b.name || b.product_name}</td>
                <td className="px-4 py-3 text-muted">{b.product_name}</td>
                <td className="px-4 py-3">{b.item_count} {b.item_count === 1 ? "component" : "components"}</td>
                <td className="px-4 py-3">{formatCurrency(b.total_cost, currencySymbol)}</td>
                <td className="px-4 py-3"><span className={`badge ${b.is_active ? "badge-success" : "badge-danger"}`}>{b.is_active ? "Active" : "Inactive"}</span></td>
                <td className="px-4 py-3 text-muted">{formatDate(b.updated_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setViewing(b); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${b.name}`}><Eye size={16} /></button>
                    {can("bom.update") && (
                      <button onClick={(e) => { e.stopPropagation(); setEditing(b); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${b.name}`}><Pencil size={16} /></button>
                    )}
                    {can("bom.delete") && (
                      <button onClick={(e) => { e.stopPropagation(); setDeleting(b); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${b.name}`}><Trash2 size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {showForm && (
        <BomForm
          bom={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && <BomDetail bom={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Delete BOM"
        message={`Are you sure you want to delete the BOM for '${deleting?.product_name}'? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function useManufacturableProducts() {
  const all = useSelectableProducts();
  return all.filter((p) => !p.is_variant && !(p.variants && p.variants.length > 0));
}

function BomForm({ bom, onClose, onSaved }: { bom: BOM | null; onClose: () => void; onSaved: () => void }) {
  const products = useManufacturableProducts();
  const [productId, setProductId] = useState(bom ? String(bom.product_id) : "");
  const [name, setName] = useState(bom?.name ?? "");
  const [description, setDescription] = useState(bom?.description ?? "");
  const [isActive, setIsActive] = useState(bom?.is_active ?? true);
  const [rows, setRows] = useState(
    bom?.items.map((i) => ({ product_id: String(i.product_id), quantity: String(i.quantity) })) || [{ product_id: "", quantity: "1" }]
  );
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      addToast("Select an output product", "error");
      return;
    }
    const items = rows
      .filter((r) => r.product_id)
      .map((r) => ({ product_id: Number(r.product_id), quantity: parseInt(r.quantity) || 1 }));
    if (items.length === 0) {
      addToast("Add at least one component", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = { product_id: Number(productId), name: name.trim(), description: description.trim(), is_active: isActive, items };
      if (bom) {
        await api.put(`/boms/${bom.id}`, payload);
        addToast("BOM updated", "success");
      } else {
        const { data } = await api.post("/boms", payload);
        addToast(`BOM for '${data.product_name}' created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving BOM"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={bom ? "Edit BOM" : "New BOM"} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Output Product</label>
            <FittedSelect
              ariaLabel="Output product"
              value={productId}
              onChange={setProductId}
              disabled={!!bom}
              options={[
                { value: "", label: "Select product..." },
                ...products.map((p) => ({ value: String(p.id), label: productLabel(p) })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">BOM Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to product name" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="border border-border rounded-xl overflow-hidden bg-app/50">
          <div className="bg-app px-4 py-2.5 flex items-center justify-between border-b border-border">
            <span className="text-sm font-medium text-ink flex items-center gap-2">
              <Layers size={15} className="text-faint" />
              Components
              {rows.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary-soft text-primary-strong dark:text-primary text-xs font-semibold">{rows.length}</span>
              )}
            </span>
            <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1" }])} className="btn-secondary text-xs py-1 px-2">
              <Plus size={14} className="inline mr-0.5" />Add Component
            </button>
          </div>
          <div className="divide-y divide-border max-h-[40vh] overflow-auto bg-surface">
            {rows.map((row, idx) => (
              <div key={idx} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
                <div className="sm:col-span-8">
                  <label className="block text-xs font-medium text-muted mb-1">Product</label>
                  <FittedSelect
                    ariaLabel="Component product"
                    value={row.product_id}
                    onChange={(v) => setRow(idx, "product_id", v)}
                    options={[
                      { value: "", label: "Select..." },
                      ...products.filter((p) => p.id !== Number(productId)).map((p) => ({ value: String(p.id), label: productLabel(p) })),
                    ]}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Qty</label>
                  <input type="number" min={1} className="input" value={row.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400 transition-colors" aria-label="Remove component">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted -mt-1">Cycle checks are enforced server-side; each component may appear only once.</p>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="rounded" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !productId} className="btn-primary">{saving ? "Saving..." : "Save BOM"}</button>
        </div>
      </form>
    </SlideOver>
  );
}

function BomDetail({ bom, onClose }: { bom: BOM; onClose: () => void }) {
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { data: cost } = useQuery({
    queryKey: ["product-cost", bom.product_id],
    queryFn: async () => {
      const { data } = await api.get(`/costing/products/${bom.product_id}`);
      return data as ProductCost;
    },
  });
  const rolledUp = cost?.unit_cost;
  const direct = bom.total_cost;
  const variance = rolledUp !== undefined ? rolledUp - direct : 0;
  const componentCost = (productId: number) => cost?.items.find((c) => c.product_id === productId)?.component_unit_cost;
  return (
    <SlideOver
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {bom.name || bom.product_name}
          <span className={`badge ${bom.is_active ? "badge-success" : "badge-danger"}`}>{bom.is_active ? "Active" : "Inactive"}</span>
        </span>
      }
      wide
    >
      <div className="space-y-5">
        <div className="border border-border rounded-xl px-5 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Output Product</p>
              <p className="font-medium text-ink break-words">{bom.product_name}</p>
            </div>
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Components</p>
              <p className="font-semibold text-ink tabular-nums">{bom.item_count}</p>
            </div>
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Direct Unit Cost</p>
              <p className="font-semibold text-ink tabular-nums">{formatCurrency(direct, currencySymbol)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Rolled-Up Cost</p>
              <p className={`font-semibold tabular-nums break-words ${rolledUp !== undefined && variance > 0 ? "text-amber-600 dark:text-amber-400" : "text-ink"}`}>
                {rolledUp !== undefined ? formatCurrency(rolledUp, currencySymbol) : formatCurrency(direct, currencySymbol)}
              </p>
              {rolledUp !== undefined && (
                <p className="text-[11px] mt-0.5 tabular-nums text-faint">
                  {variance > 0 ? `+${formatCurrency(variance, currencySymbol)} merged from sub-parts` : variance < 0 ? `${formatCurrency(variance, currencySymbol)} vs direct` : "matches direct cost"}
                </p>
              )}
            </div>
          </div>
        </div>

        {bom.description && (
          <div className="text-sm">
            <p className="text-muted">Description</p>
            <p className="font-medium">{bom.description}</p>
          </div>
        )}

        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-app px-4 py-2.5 text-sm font-semibold text-ink border-b border-border">Component Breakdown</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Component</th>
                <th className="px-4 py-2 font-medium text-muted">Qty</th>
                <th className="px-4 py-2 font-medium text-muted">Unit Cost</th>
                <th className="px-4 py-2 font-medium text-muted">Line Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bom.items.map((item) => {
                const rolled = componentCost(item.product_id);
                const unit = rolled !== undefined ? rolled : item.unit_cost;
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-2 font-medium">{item.product_name}</td>
                    <td className="px-4 py-2">{item.quantity}</td>
                    <td className="px-4 py-2">
                      {formatCurrency(unit, currencySymbol)}
                      {rolled !== undefined && rolled !== item.unit_cost && <span className="text-faint text-xs"> (direct {formatCurrency(item.unit_cost, currencySymbol)})</span>}
                    </td>
                    <td className="px-4 py-2">{formatCurrency(item.quantity * unit, currencySymbol)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </SlideOver>
  );
}