import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Eye, Gift, Pencil, Plus, Search, Trash2, PackagePlus, PackageMinus, Layers } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Kit, PaginatedResponse, ProductCost, Location } from "../types";
import Modal from "../components/Modal";
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
import { PAGE_SIZE_LOOKUP } from "../utils/constants";

export default function Kits() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Kit | null>(null);
  const [viewing, setViewing] = useState<Kit | null>(null);
  const [deleting, setDeleting] = useState<Kit | null>(null);
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["kits", debouncedSearch, includeInactive, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (!includeInactive) params.is_active = "true";
      const { data } = await api.get("/kits", { params });
      return data as PaginatedResponse<Kit>;
    },
  });

  const kits = data?.items || [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/kits/${id}`),
    onSuccess: () => {
      addToast("Kit deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["kits"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete kit"), "error");
    },
    onSettled: () => setDeleting(null),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["kits"] });

  const openNew = () => { setEditing(null); setShowForm(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Gift size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink tracking-tight">Kits</h1>
            <p className="text-sm text-muted mt-0.5">Bundle multiple products into sellable kits with bundle pricing and discounting.</p>
          </div>
        </div>
        {can("kit.create") && (
          <button onClick={openNew} className="btn-primary shrink-0">
            <Plus size={16} /> New Kit
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by kit name, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search kits" />
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
        <table className="w-full text-sm" role="grid" aria-label="Kits table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">Kit</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Output Product</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Components</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Bundle Price</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Retail Value</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Discount</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Updated</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={9} />
            ) : isError ? (
              <ErrorState onRetry={refresh} />
            ) : kits.length === 0 ? (
              <EmptyState title="No kits yet" message="Create a kit to bundle products into a sellable collection." actionLabel="New Kit" onAction={openNew} />
            ) : kits.map((k) => (
              <tr key={k.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(k)}>
                <td className="px-4 py-3 font-medium">{k.name}</td>
                <td className="px-4 py-3 text-muted">{k.product_name}</td>
                <td className="px-4 py-3">{k.item_count} {k.item_count === 1 ? "component" : "components"}</td>
                <td className="px-4 py-3">{formatCurrency(k.bundle_price, currencySymbol)}</td>
                <td className="px-4 py-3 text-muted">{formatCurrency(k.retail_value, currencySymbol)}</td>
                <td className="px-4 py-3 text-muted">{k.discount_type === "percentage" ? `${k.discount_value}%` : formatCurrency(k.discount_value, currencySymbol)}</td>
                <td className="px-4 py-3"><span className={`badge ${k.is_active ? "badge-success" : "badge-danger"}`}>{k.is_active ? "Active" : "Inactive"}</span></td>
                <td className="px-4 py-3 text-muted">{formatDate(k.updated_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setViewing(k); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${k.name}`}><Eye size={16} /></button>
                    {can("kit.update") && (
                      <button onClick={(e) => { e.stopPropagation(); setEditing(k); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${k.name}`}><Pencil size={16} /></button>
                    )}
                    {can("kit.delete") && (
                      <button onClick={(e) => { e.stopPropagation(); setDeleting(k); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${k.name}`}><Trash2 size={16} /></button>
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
        <KitForm
          kit={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && (
        <KitDetail
          kit={viewing}
          onClose={() => setViewing(null)}
          onEdited={refresh}
          onEdit={can("kit.update") ? () => { setEditing(viewing); setViewing(null); setShowForm(true); } : undefined}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Kit"
        message={`Are you sure you want to delete the kit '${deleting?.name}'? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function useKitProducts() {
  const all = useSelectableProducts();
  return all.filter((p) => !p.is_variant && !(p.variants && p.variants.length > 0));
}

function KitForm({ kit, onClose, onSaved }: { kit: Kit | null; onClose: () => void; onSaved: () => void }) {
  const products = useKitProducts();
  const [productId, setProductId] = useState(kit ? String(kit.product_id) : "");
  const [name, setName] = useState(kit?.name ?? "");
  const [description, setDescription] = useState(kit?.description ?? "");
  const [version, setVersion] = useState(kit?.version ?? "");
  const [discountType, setDiscountType] = useState(kit?.discount_type ?? "fixed");
  const [discountValue, setDiscountValue] = useState(kit ? String(kit.discount_value) : "");
  const [isActive, setIsActive] = useState(kit?.is_active ?? true);
  const [rows, setRows] = useState(
    kit?.items.map((i) => ({ product_id: String(i.product_id), quantity: String(i.quantity) })) || [{ product_id: "", quantity: "1" }]
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
      const payload = {
        product_id: Number(productId),
        name: name.trim(),
        description: description.trim(),
        version: version.trim(),
        is_active: isActive,
        discount_type: discountType,
        discount_value: discountValue === "" ? 0 : Number(discountValue),
        items,
      };
      if (kit) {
        const { discount_type: dt, discount_value: dv, ...rest } = payload;
        await api.put(`/kits/${kit.id}`, { ...rest, discount_type: dt, discount_value: dv });
        addToast("Kit updated", "success");
      } else {
        const { data } = await api.post("/kits", payload);
        addToast(`Kit '${data.name}' created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving kit"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={kit ? "Edit Kit" : "New Kit"} wide ariaLabel={kit ? `Edit ${kit.name}` : "New Kit"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Output Product</label>
            <FittedSelect
              ariaLabel="Output product"
              value={productId}
              onChange={setProductId}
              disabled={!!kit}
              options={[
                { value: "", label: "Select product..." },
                ...products.map((p) => ({ value: String(p.id), label: productLabel(p) })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Kit Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Starter Bundle" />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">Pricing</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Version</label>
              <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. v1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Discount Type</label>
              <FittedSelect
                ariaLabel="Discount type"
                value={discountType}
                onChange={(v) => setDiscountType(v as "fixed" | "percentage")}
                options={[
                  { value: "fixed", label: "Fixed amount" },
                  { value: "percentage", label: "Percentage" },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                {discountType === "percentage" ? "Discount (%)" : "Discount (amount)"}
              </label>
              <input type="number" min={0} step={discountType === "percentage" ? "0.01" : "0.01"} className="input" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            </div>
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

        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 sm:flex-none">Cancel</button>
          <button type="submit" disabled={saving || !productId} className="btn-primary flex-1 sm:flex-none">{saving ? "Saving..." : "Save Kit"}</button>
        </div>
      </form>
    </SlideOver>
  );
}

function useLocationOptions() {
  const { data, isLoading } = useQuery<Location[]>({
    queryKey: ["locations", "picker"],
    queryFn: async () => {
      const resp = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return resp.data.items;
    },
  });
  const locations = (data || []).filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path));
  return { locations, isLoading };
}

function KitDetail({ kit, onClose, onEdited, onEdit }: { kit: Kit; onClose: () => void; onEdited: () => void; onEdit?: () => void }) {
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [showAssemble, setShowAssemble] = useState(false);
  const [showDisassemble, setShowDisassemble] = useState(false);
  const [actionQty, setActionQty] = useState("1");
  const [actionLocation, setActionLocation] = useState("");
  const { locations: allLocations } = useLocationOptions();
  const [busy, setBusy] = useState(false);

  const { data: cost } = useQuery({
    queryKey: ["product-cost", kit.product_id],
    queryFn: async () => {
      const { data } = await api.get(`/costing/products/${kit.product_id}`);
      return data as ProductCost;
    },
  });
  const componentCost = (productId: number) => cost?.items.find((c) => c.product_id === productId)?.component_unit_cost;

  const runAction = async (action: "assemble" | "disassemble") => {
    const qty = parseInt(actionQty) || 0;
    if (qty <= 0) return addToast("Enter a valid quantity", "error");
    const locationMatch = actionLocation ? allLocations.find((l) => l.path === actionLocation.trim()) : undefined;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { quantity: qty };
      if (locationMatch) payload.location_id = locationMatch.id;
      await api.post(`/kits/${kit.id}/${action}`, payload);
      addToast(action === "assemble" ? `Assembled ${qty} x '${kit.product_name}'` : `Disassembled ${qty} x '${kit.product_name}'`, "success");
      setShowAssemble(false);
      setShowDisassemble(false);
      queryClient.invalidateQueries({ queryKey: ["kits"] });
      onEdited();
    } catch (err: unknown) {
      addToast(errorMessage(err, action === "assemble" ? "Cannot assemble kit" : "Cannot disassemble kit"), "error");
    }
    setBusy(false);
  };

  const renderActionModal = (action: "assemble" | "disassemble") => (
    <Modal open onClose={() => { setShowAssemble(false); setShowDisassemble(false); }} title={action === "assemble" ? `Assemble ${kit.name}` : `Disassemble ${kit.name}`}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {action === "assemble"
            ? `Consume component stock to produce finished ${kit.product_name} kit stock.`
            : `Break down ${kit.product_name} kit stock back into its component products.`}
        </p>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
          <input type="number" min={1} className="input" value={actionQty} onChange={(e) => setActionQty(e.target.value)} aria-label="Quantity" />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Location (optional)</label>
          <input type="text" className="input" list="kit-location-options" value={actionLocation} onChange={(e) => setActionLocation(e.target.value)} placeholder="Defaults to component stock location" aria-label="Location" />
          <datalist id="kit-location-options">
            {allLocations.map((l) => (
              <option key={l.id} value={l.path}>{l.name}</option>
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button onClick={() => { setShowAssemble(false); setShowDisassemble(false); }} className="btn-secondary flex-1 sm:flex-none" disabled={busy}>Cancel</button>
          <button onClick={() => runAction(action)} disabled={busy} className={`${action === "assemble" ? "btn-primary" : "btn-secondary"} flex-1 sm:flex-none`}>
            {busy ? "Working..." : action === "assemble" ? "Assemble kit" : "Disassemble kit"}
          </button>
        </div>
      </div>
    </Modal>
  );

  const headerActions = onEdit ? (
    <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label={`Edit ${kit.name}`}>
      <Pencil size={14} />Edit Kit
    </button>
  ) : undefined;

  return (
    <>
      <SlideOver
        open
        onClose={onClose}
        title={kit.name || kit.product_name}
        wide
        ariaLabel={`${kit.name || kit.product_name} details`}
        actions={headerActions}
      >
        <div className="space-y-5">
          <div className="border border-border rounded-xl px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-semibold text-faint uppercase tracking-wider">Overview</span>
              <span className={`badge ${kit.is_active ? "badge-success" : "badge-danger"}`}>{kit.is_active ? "Active" : "Inactive"}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
              <div className="min-w-0">
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Output Product</p>
                <p className="font-medium text-ink break-words">{kit.product_name}</p>
                {kit.version && <p className="text-[11px] text-faint mt-0.5">Version {kit.version}</p>}
              </div>
              <div className="min-w-0">
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Bundle Price</p>
                <p className="font-semibold text-primary-strong dark:text-primary tabular-nums">{formatCurrency(kit.bundle_price, currencySymbol)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Retail Value</p>
                <p className="font-semibold text-muted line-through tabular-nums">{formatCurrency(kit.retail_value, currencySymbol)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">You Save</p>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(kit.savings, currencySymbol)}</p>
              </div>
            </div>
          </div>

          <div className="flex items-baseline justify-between px-1">
            <span className="text-sm text-muted">Total component cost</span>
            <span className="text-sm font-semibold text-ink tabular-nums">{formatCurrency(kit.total_cost, currencySymbol)}</span>
          </div>

          {kit.description && (
            <div className="text-sm">
              <p className="text-muted">Description</p>
              <p className="font-medium">{kit.description}</p>
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
                  <th className="px-4 py-2 font-medium text-muted">Retail</th>
                  <th className="px-4 py-2 font-medium text-muted text-right">Line Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {kit.items.map((item) => {
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
                      <td className="px-4 py-2">{formatCurrency(item.unit_price * item.quantity, currencySymbol)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(item.quantity * unit, currencySymbol)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="flex flex-wrap gap-2">
              {can("kit.update") && (
                <>
                  <button onClick={() => { setActionQty("1"); setActionLocation(""); setShowAssemble(true); }} className="btn-primary text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
                    <PackagePlus size={15} />Assemble
                  </button>
                  <button onClick={() => { setActionQty("1"); setActionLocation(""); setShowDisassemble(true); }} className="btn-secondary text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
                    <PackageMinus size={15} />Disassemble
                  </button>
                </>
              )}
            </div>
            <button onClick={onClose} className="btn-secondary flex-1 sm:flex-none">Close</button>
          </div>
        </div>
      </SlideOver>
      {showAssemble && renderActionModal("assemble")}
      {showDisassemble && renderActionModal("disassemble")}
    </>
  );
}