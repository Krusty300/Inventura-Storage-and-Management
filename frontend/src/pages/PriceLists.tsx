import { useState } from "react";
import { Pencil, Trash2, Search, Tag, Star } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, PriceList } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

export default function PriceLists() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PriceList | null>(null);
  const [deleting, setDeleting] = useState<PriceList | null>(null);
  const [viewing, setViewing] = useState<PriceList | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["price-lists", debouncedSearch, page],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * 50).toString(), limit: "50" };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/price-lists", { params });
      return data as PaginatedResponse<PriceList>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/price-lists/${id}`),
    onSuccess: () => { addToast("Price list deleted", "success"); queryClient.invalidateQueries({ queryKey: ["price-lists"] }); },
    onError: (err: any) => { addToast(err.response?.data?.detail || "Cannot delete", "error"); },
  });

  const priceLists = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Price Lists</h1>
        {can("price_lists.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">Add Price List</button>
        )}
      </div>

      {isError && <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load price lists: {(error as any)?.message}</div>}

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
                <EmptyState title="No price lists" message="Create your first price list to manage product pricing." actionLabel="Add Price List" onAction={() => { setEditing(null); setShowForm(true); }} />
              ) : priceLists.map((pl) => (
                <tr key={pl.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(pl)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Tag size={16} className="text-indigo-500" />
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
                      {can("price_lists.update") && <button onClick={() => { setEditing(pl); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${pl.name}`}><Pencil size={16} /></button>}
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

      {showForm && <PriceListForm priceList={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["price-lists"] }); }} />}
      {deleting && <ConfirmDialog open title="Delete Price List" message={`Delete "${deleting.name}"? This cannot be undone.`} onConfirm={() => { deleteMutation.mutate(deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)} />}
      {viewing && <PriceListDetail priceList={viewing} onClose={() => setViewing(null)} onEdit={can("price_lists.update") ? () => { setEditing(viewing); setShowForm(true); setViewing(null); } : undefined} />}
    </div>
  );
}

function PriceListForm({ priceList, onClose, onSaved }: { priceList: PriceList | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(priceList?.name || "");
  const [description, setDescription] = useState(priceList?.description || "");
  const [validFrom, setValidFrom] = useState(priceList?.valid_from || "");
  const [validTo, setValidTo] = useState(priceList?.valid_to || "");
  const [isDefault, setIsDefault] = useState(priceList?.is_default || false);
  const [items, setItems] = useState<{ product_id: string; price: string; min_qty: string }[]>(
    priceList?.items?.map((i) => ({ product_id: String(i.product_id), price: String(i.price), min_qty: String(i.min_qty) })) || []
  );
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const addItem = () => setItems([...items, { product_id: "", price: "", min_qty: "1" }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, key: string, val: string) => {
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
          product_id: Number(i.product_id),
          price: parseFloat(i.price) || 0,
          min_qty: parseInt(i.min_qty) || 1,
        })),
      };
      if (priceList) {
        await api.put(`/price-lists/${priceList.id}`, body);
        addToast("Price list updated", "success");
      } else {
        await api.post("/price-lists", body);
        addToast("Price list created", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving price list", "error");
    }
    setSaving(false);
  };

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
            <button type="button" onClick={addItem} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ Add item</button>
          </div>
          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_120px_80px_32px] gap-2 items-center">
                  <input className="input text-sm" placeholder="Product ID" type="number" min="1" value={item.product_id} onChange={(e) => updateItem(idx, "product_id", e.target.value)} />
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

function PriceListDetail({ priceList, onClose, onEdit }: { priceList: PriceList; onClose: () => void; onEdit?: () => void }) {
  return (
    <Modal open onClose={onClose} title={priceList.name} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted">Description:</span> <span className="text-ink">{priceList.description || "\u2014"}</span></div>
          <div><span className="text-muted">Default:</span> <span className="text-ink">{priceList.is_default ? "Yes" : "No"}</span></div>
          <div><span className="text-muted">Valid From:</span> <span className="text-ink">{priceList.valid_from || "\u2014"}</span></div>
          <div><span className="text-muted">Valid To:</span> <span className="text-ink">{priceList.valid_to || "\u2014"}</span></div>
          <div><span className="text-muted">Status:</span> <span className={`font-medium ${priceList.is_active ? "text-green-600 dark:text-green-400" : "text-muted"}`}>{priceList.is_active ? "Active" : "Inactive"}</span></div>
          <div><span className="text-muted">Items:</span> <span className="text-ink font-medium">{priceList.item_count}</span></div>
        </div>

        {priceList.items && priceList.items.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-ink mb-2">Price List Items</h4>
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th className="px-4 py-2 font-medium text-muted">Product</th>
                    <th className="px-4 py-2 font-medium text-muted">SKU</th>
                    <th className="px-4 py-2 font-medium text-muted text-right">Price</th>
                    <th className="px-4 py-2 font-medium text-muted text-right">Min Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {priceList.items.map((item) => (
                    <tr key={item.id} className="hover:bg-app">
                      <td className="px-4 py-2">{item.product_name || `Product #${item.product_id}`}</td>
                      <td className="px-4 py-2 text-muted">{item.product_sku}</td>
                      <td className="px-4 py-2 text-right font-medium">${item.price.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right">{item.min_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Close</button>
          {onEdit && <button type="button" onClick={onEdit} className="btn-primary">Edit</button>}
        </div>
      </div>
    </Modal>
  );
}
