import { useState, useEffect, useMemo, type ReactNode } from "react";
import { Pencil, Trash2, Search, Tag, Star, BadgePercent, CalendarRange, Layers, Package } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, PriceList } from "../types";
import Modal from "../components/Modal";
import SlideOver from "../components/SlideOver";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import TextArea from "../components/TextArea";
import EmptyState from "../components/EmptyState";
import ProductPicker from "../components/ProductPicker";
import DatePicker from "../components/DatePicker";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { usePageSize } from "../hooks/usePageSize";
import { useDateFormat } from "../hooks/useDateFormat";
import { errorMessage } from "../utils/errors";
import { formatCurrency } from "../utils/currency";

export default function PriceLists() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<PriceList | null>(null);
  const [viewing, setViewing] = useState<PriceList | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const debouncedSearch = useDebounce(search, 300);

  const { data: editingPL, isFetching: loadingEdit } = useQuery({
    queryKey: ["price-lists", editingId],
    queryFn: async () => {
      const { data } = await api.get(`/price-lists/${editingId}`);
      return data as PriceList;
    },
    enabled: editingId !== null,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["price-lists", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/price-lists", { params });
      return data as PaginatedResponse<PriceList>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/price-lists/${id}`),
    onSuccess: () => { addToast("Price list deleted", "success"); setViewing(null); queryClient.invalidateQueries({ queryKey: ["price-lists"] }); },
    onError: (err: unknown) => { addToast(errorMessage(err, "Cannot delete"), "error"); },
  });

  const priceLists = useMemo(() => data?.items ?? [], [data]);

  useEffect(() => {
    if (!viewing) return;
    const fresh = priceLists.find((pl) => pl.id === viewing.id);
    if (fresh) {
      setViewing((prev) => {
        if (!prev) return null;
        return { ...prev, name: fresh.name, description: fresh.description, is_default: fresh.is_default, is_active: fresh.is_active, item_count: fresh.item_count, valid_from: fresh.valid_from, valid_to: fresh.valid_to };
      });
    }
  }, [priceLists, viewing]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Tag size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Price Lists</h1>
            <p className="text-sm text-muted mt-1">Set and manage pricing tiers for your products.</p>
          </div>
        </div>
        {can("price_lists.create") && (
          <button onClick={() => { setEditingId(null); setShowForm(true); }} className="btn-primary">Add Price List</button>
        )}
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load price lists")}</div>}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input className="input pl-10" placeholder="Search price lists..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search price lists" />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Price lists table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Name</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Items</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Valid From</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Valid To</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={6} />
              ) : priceLists.length === 0 ? (
                <EmptyState title={search ? "No matching price lists" : "No price lists"} message={search ? `Nothing matched "${search}". Try adjusting your search.` : "Create your first price list to manage product pricing."} actionLabel={search ? undefined : "Add Price List"} onAction={search ? undefined : () => { setEditingId(null); setShowForm(true); }} />
              ) : priceLists.map((pl) => (
                <tr key={pl.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(pl)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Tag size={16} className="text-primary" />
                      <span className="font-medium">{pl.name}</span>
                      {pl.is_default && <Star size={14} className="text-amber-500 fill-amber-500" aria-label="Default" />}
                    </div>
                    {pl.description && <p className="text-xs text-muted mt-0.5">{pl.description}</p>}
                  </td>
                  <td className="px-4 py-3">{pl.item_count}</td>
                  <td className="px-4 py-3 text-muted">{pl.valid_from || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{pl.valid_to || "\u2014"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pl.is_active ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400"}`}>
                      {pl.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      {can("price_lists.update") && <button onClick={() => { setEditingId(pl.id); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${pl.name}`}><Pencil size={16} /></button>}
                      {can("price_lists.delete") && <button onClick={() => setDeleting(pl)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${pl.name}`}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.pages > 1 && <Pagination page={page} totalPages={data.pages} onPageChange={setPage} />}

      {showForm && editingId && loadingEdit && <Modal open onClose={() => { setShowForm(false); setEditingId(null); }} title="Loading..." breadcrumb="" wide><Skeleton rows={3} cols={2} /></Modal>}
      {showForm && editingId && editingPL && <PriceListForm priceList={editingPL} onClose={() => { setShowForm(false); setEditingId(null); }} onSaved={(fresh) => { setShowForm(false); setEditingId(null); setViewing(fresh); queryClient.invalidateQueries({ queryKey: ["price-lists"] }); }} />}
      {showForm && !editingId && <PriceListForm priceList={null} onClose={() => { setShowForm(false); setEditingId(null); }} onSaved={(fresh) => { setShowForm(false); setEditingId(null); setViewing(fresh); queryClient.invalidateQueries({ queryKey: ["price-lists"] }); }} />}
      {deleting && <ConfirmDialog open title="Delete Price List" message={`Delete "${deleting.name}"? This cannot be undone.`} onConfirm={() => { deleteMutation.mutate(deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)} />}
      {viewing && <PriceListDetail priceList={viewing} currencySymbol={currencySymbol} onClose={() => setViewing(null)} onEdit={can("price_lists.update") ? (freshPl) => { setEditingId(freshPl.id); setShowForm(true); setViewing(null); } : undefined} />}
    </div>
  );
}

function PriceListForm({ priceList, onClose, onSaved }: { priceList: PriceList | null; onClose: () => void; onSaved: (fresh: PriceList) => void }) {
  const [name, setName] = useState(priceList?.name || "");
  const [description, setDescription] = useState(priceList?.description || "");
  const [validFrom, setValidFrom] = useState(priceList?.valid_from || "");
  const [validTo, setValidTo] = useState(priceList?.valid_to || "");
  const [isDefault, setIsDefault] = useState(priceList?.is_default || false);
  const [items, setItems] = useState<{ product_id: number | null; price: string; min_qty: string }[]>(
    priceList?.items?.map((i) => ({ product_id: i.product_id, price: String(i.price), min_qty: String(i.min_qty) })) || []
  );
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const addItem = () => setItems([...items, { product_id: null, price: "", min_qty: "1" }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, key: string, val: number | null | string) => {
    const next = [...items];
    next[idx] = { ...next[idx], [key]: val };
    setItems(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description,
        valid_from: validFrom || null,
        valid_to: validTo || null,
        is_default: isDefault,
        items: items.filter((i) => i.product_id && i.price).map((i) => ({
          product_id: i.product_id!,
          price: parseFloat(i.price) || 0,
          min_qty: parseInt(i.min_qty) || 1,
        })),
      };
      if (priceList) {
        const { data: fresh } = await api.put(`/price-lists/${priceList.id}`, body);
        addToast("Price list updated", "success");
        onSaved(fresh as PriceList);
      } else {
        const { data: fresh } = await api.post("/price-lists", body);
        addToast("Price list created", "success");
        onSaved(fresh as PriceList);
      }
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving price list"), "error");
    }
    setSaving(false);
  };

  const usedProductIds = items.filter((i) => i.product_id !== null).map((i) => i.product_id as number);

  return (
    <SlideOver
      open
      onClose={onClose}
      wide
      ariaLabel={priceList ? "Edit Price List" : "Add Price List"}
      title={priceList ? "Edit Price List" : "Add Price List"}
      actions={
        <button type="submit" form="price-list-form" disabled={saving || !name.trim()} className="btn-primary">
          {saving ? "Saving..." : priceList ? "Update" : "Create"}
        </button>
      }
    >
      <form id="price-list-form" onSubmit={handleSubmit} className="space-y-5">
        <section className="border border-border rounded-xl overflow-hidden">
          <header className="px-5 py-3 bg-app border-b border-border flex items-center gap-2">
            <Tag size={16} className="text-primary shrink-0" />
            <h3 className="text-sm font-semibold text-ink">Details</h3>
          </header>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Name *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wholesale 2026" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Description</label>
              <TextArea rows={2} value={description} onChange={setDescription} placeholder="Optional note about this price list" />
            </div>
          </div>
        </section>

        <section className="border border-border rounded-xl overflow-hidden">
          <header className="px-5 py-3 bg-app border-b border-border flex items-center gap-2">
            <CalendarRange size={16} className="text-primary shrink-0" />
            <h3 className="text-sm font-semibold text-ink">Validity</h3>
          </header>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Valid From</label>
                <DatePicker value={validFrom} onChange={setValidFrom} ariaLabel="Valid From" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Valid To</label>
                <DatePicker value={validTo} onChange={setValidTo} ariaLabel="Valid To" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" className="rounded border-border-strong" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Set as default price list
            </label>
          </div>
        </section>

        <section className="border border-border rounded-xl overflow-hidden">
          <header className="px-5 py-3 bg-app border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-ink">Pricing Items</h3>
              <span className="text-xs text-muted">({items.length})</span>
            </div>
            <button type="button" onClick={addItem} className="btn-secondary text-xs px-2.5 py-1">+ Add item</button>
          </header>
          {items.length > 0 ? (
            <div className="p-5 space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_120px_80px_36px] gap-2 items-center">
                  <ProductPicker
                    value={item.product_id}
                    onChange={(id) => updateItem(idx, "product_id", id)}
                    excludeIds={usedProductIds.filter((_, i) => i !== idx)}
                    placeholder="Select product..."
                  />
                  <div>
                    <span className="sr-only">Price {idx + 1}</span>
                    <input className="input text-sm" placeholder="Price" type="number" step="0.01" min="0" value={item.price} onChange={(e) => updateItem(idx, "price", e.target.value)} />
                  </div>
                  <div>
                    <span className="sr-only">Min quantity {idx + 1}</span>
                    <input className="input text-sm" placeholder="Min" type="number" min="1" value={item.min_qty} onChange={(e) => updateItem(idx, "min_qty", e.target.value)} />
                  </div>
                  <button type="button" onClick={() => removeItem(idx)} className="p-1.5 text-faint hover:text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-500/10" aria-label="Remove item" title="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No items yet" message="Add a product to start pricing." />
          )}
        </section>
      </form>
    </SlideOver>
  );
}

function DetailStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-app p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p className="text-sm font-semibold text-ink mt-0.5 truncate" title={typeof children === "string" ? children : undefined}>{children}</p>
    </div>
  );
}

function PriceListDetail({ priceList, currencySymbol, onClose, onEdit }: { priceList: PriceList; currencySymbol: string; onClose: () => void; onEdit?: (pl: PriceList) => void }) {
  const formatDate = useDateFormat();
  const { data: fresh, isLoading } = useQuery({
    queryKey: ["price-lists", priceList.id],
    queryFn: async () => {
      const { data } = await api.get(`/price-lists/${priceList.id}`);
      return data as PriceList;
    },
    staleTime: 30_000,
  });

  const pl = fresh ?? priceList;
  const items = pl.items ?? [];
  const tierCount = items.filter((i) => i.min_qty > 1).length;
  const validity = [pl.valid_from, pl.valid_to].filter(Boolean).join(" → ") || "—";

  return (
    <SlideOver open onClose={onClose} title={pl.name} wide ariaLabel={pl.name}>
      <div className="space-y-5">
        <div className="border border-border rounded-xl overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:bg-primary/15 dark:text-primary flex items-center justify-center shrink-0">
                  <BadgePercent size={22} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-faint">Price List</p>
                  <h3 className="text-xl font-bold text-ink mt-0.5 truncate">{pl.name}</h3>
                  {pl.description && <p className="text-sm text-muted mt-1">{pl.description}</p>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className={`badge ${pl.is_active ? "badge-success" : "badge-neutral"}`}>
                  {pl.is_active ? "Active" : "Inactive"}
                </span>
                {pl.is_default && (
                  <span className="badge badge-warning inline-flex items-center gap-1">
                    <Star size={12} className="fill-amber-500 text-amber-500" />Default
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-5">
            <DetailStat label="Items">{pl.item_count}</DetailStat>
            <DetailStat label="Quantity tiers">{tierCount > 0 ? tierCount : "—"}</DetailStat>
            <DetailStat label="Validity">
              <span className="inline-flex items-center gap-1">
                <CalendarRange size={14} className="text-faint shrink-0" />
                <span className="truncate">{validity}</span>
              </span>
            </DetailStat>
            <DetailStat label="Updated">{pl.updated_at ? formatDate(pl.updated_at) : "—"}</DetailStat>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-ink inline-flex items-center gap-2">
              <Package size={16} className="text-primary shrink-0" />
              Products <span className="text-xs font-normal text-muted">({items.length})</span>
            </h4>
            {tierCount > 0 && (
              <span className="badge badge-info inline-flex items-center gap-1">
                <Layers size={12} />{tierCount} tier{tierCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {isLoading ? (
            <Skeleton rows={3} cols={4} />
          ) : items.length === 0 ? (
            <EmptyState variant="block" icon={<Package size={48} />} title="No products in this price list yet" message="Add products to set their prices in this list." />
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th className="px-4 py-2.5 font-medium text-muted">#</th>
                    <th className="px-4 py-2.5 font-medium text-muted">Product</th>
                    <th className="px-4 py-2.5 font-medium text-muted text-right">Price</th>
                    <th className="px-4 py-2.5 font-medium text-muted text-right">Min Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-app">
                      <td className="px-4 py-2.5 text-faint">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink truncate max-w-[24rem]">{item.product_name || `Product #${item.product_id}`}</div>
                        {item.product_sku && <div className="text-xs font-mono text-muted mt-0.5">{item.product_sku}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-ink whitespace-nowrap">{formatCurrency(item.price, currencySymbol)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center justify-center min-w-[2.5rem] rounded-full px-2.5 py-1 text-xs font-semibold text-ink bg-subtle border border-border">
                          {item.min_qty}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {onEdit && (
          <div className="flex justify-end pt-2 border-t border-border">
            <button type="button" onClick={() => onEdit(pl)} className="btn-primary inline-flex items-center gap-2">
              <Pencil size={16} /> Edit Price List
            </button>
          </div>
        )}
      </div>
    </SlideOver>
  );
}
