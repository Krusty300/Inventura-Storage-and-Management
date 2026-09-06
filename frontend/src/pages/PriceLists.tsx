import { useState, useEffect } from "react";
import { Pencil, Trash2, Search, Tag, Star } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, PriceList } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ProductPicker from "../components/ProductPicker";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { usePageSize } from "../hooks/usePageSize";
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

  const priceLists = data?.items || [];

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
                <EmptyState title="No price lists" message="Create your first price list to manage product pricing." actionLabel="Add Price List" onAction={() => { setEditingId(null); setShowForm(true); }} />
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

      {showForm && editingId && loadingEdit && <Modal open onClose={() => { setShowForm(false); setEditingId(null); }} title="Loading..." wide><Skeleton rows={3} cols={2} /></Modal>}
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
    <Modal open onClose={onClose} title={priceList ? "Edit Price List" : "Add Price List"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
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
          <input type="checkbox" className="rounded border-border-strong" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Set as default price list
        </label>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-ink">Price List Items</h3>
            <button type="button" onClick={addItem} className="text-sm text-primary dark:text-primary hover:underline">+ Add item</button>
          </div>
          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_120px_80px_32px] gap-2 items-center">
                  <ProductPicker
                    value={item.product_id}
                    onChange={(id) => updateItem(idx, "product_id", id)}
                    excludeIds={usedProductIds.filter((_, i) => i !== idx)}
                    placeholder="Select product..."
                  />
                  <input className="input text-sm" placeholder="Price" type="number" step="0.01" min="0" value={item.price} onChange={(e) => updateItem(idx, "price", e.target.value)} />
                  <input className="input text-sm" placeholder="Min Qty" type="number" min="1" value={item.min_qty} onChange={(e) => updateItem(idx, "min_qty", e.target.value)} />
                  <button type="button" onClick={() => removeItem(idx)} className="p-1 text-faint hover:text-red-600" aria-label="Remove item">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">{saving ? "Saving..." : priceList ? "Update" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PriceListDetail({ priceList, currencySymbol, onClose, onEdit }: { priceList: PriceList; currencySymbol: string; onClose: () => void; onEdit?: (pl: PriceList) => void }) {
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

  return (
    <Modal open onClose={onClose} title={pl.name} wide>
      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          {pl.is_default && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">Default</span>}
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pl.is_active ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400"}`}>
            {pl.is_active ? "Active" : "Inactive"}
          </span>
          <span className="text-sm text-muted">{pl.item_count} item{pl.item_count === 1 ? "" : "s"}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted">Description:</span> <span className="text-ink">{pl.description || "\u2014"}</span></div>
          <div><span className="text-muted">Valid From:</span> <span className="text-ink">{pl.valid_from || "\u2014"}</span></div>
          <div><span className="text-muted">Valid To:</span> <span className="text-ink">{pl.valid_to || "\u2014"}</span></div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-ink mb-2">Products</h4>
          {isLoading ? (
            <Skeleton rows={3} cols={4} />
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted border-2 border-dashed border-border rounded-lg">No items in this price list yet.</div>
          ) : (
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th className="px-4 py-2.5 font-medium text-muted">Product</th>
                    <th className="px-4 py-2.5 font-medium text-muted">SKU</th>
                    <th className="px-4 py-2.5 font-medium text-muted text-right">Price</th>
                    <th className="px-4 py-2.5 font-medium text-muted text-right">Min Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-app">
                      <td className="px-4 py-2.5 font-medium text-ink">{item.product_name || `Product #${item.product_id}`}</td>
                      <td className="px-4 py-2.5 text-muted font-mono text-xs">{item.product_sku || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-ink">{formatCurrency(item.price, currencySymbol)}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{item.min_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Close</button>
          {onEdit && <button type="button" onClick={() => onEdit(pl)} className="btn-primary">Edit</button>}
        </div>
      </div>
    </Modal>
  );
}
