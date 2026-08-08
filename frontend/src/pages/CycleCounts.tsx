import { useDateFormat } from "../hooks/useDateFormat";
import { useEffect, useState } from "react";
import { Eye, ClipboardCheck, Plus, Printer, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { CycleCount, Location, PaginatedResponse } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";

export default function CycleCounts() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<CycleCount | null>(null);
  const [counting, setCounting] = useState<CycleCount | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["cycle-counts", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/cycle-counts", { params });
      return data as PaginatedResponse<CycleCount>;
    },
  });

  const counts = data?.items || [];

  const statusBadge = (s: string) =>
    s === "completed" ? "badge-success" : s === "in_progress" ? "badge-info" : s === "cancelled" ? "badge-danger" : "badge-warning";

  const printPdf = async (c: CycleCount) => {
    try {
      const { data } = await api.get(`/cycle-counts/${c.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Cycle Counts</h1>
        {can("cycle_counts.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            New Count
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by count number, location, or notes..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search cycle counts" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Cycle counts table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3 font-medium text-muted">Count #</th>
              <th className="px-4 py-3 font-medium text-muted">Location</th>
              <th className="px-4 py-3 font-medium text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-muted">Expected</th>
              <th className="px-4 py-3 font-medium text-muted">Variance</th>
              <th className="px-4 py-3 font-medium text-muted">Date</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : counts.length === 0 ? (
              <EmptyState title="No cycle counts yet" message="Create a cycle count to verify on-hand stock against the system." actionLabel="New Count" onAction={() => setShowForm(true)} />
            ) : counts.map((c) => (
              <tr key={c.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{c.cc_number}</td>
                <td className="px-4 py-3 text-muted">{c.location_name || "All"}</td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(c.status)}`}>{c.status}</span></td>
                <td className="px-4 py-3">{c.total_expected}</td>
                <td className="px-4 py-3">
                  <span className={c.total_variance !== 0 ? "text-orange-600 dark:text-orange-400 font-medium" : "text-muted"}>
                    {c.total_variance > 0 ? "+" : ""}{c.total_variance}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{formatDate(c.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => printPdf(c)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print ${c.cc_number}`}><Printer size={16} /></button>
                    <button onClick={() => setViewing(c)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${c.cc_number}`}><Eye size={16} /></button>
                    {c.status !== "completed" && c.status !== "cancelled" && can("cycle_counts.count") && (
                      <button onClick={() => setCounting(c)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Count ${c.cc_number}`}><ClipboardCheck size={16} /></button>
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
        <CycleCountForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["cycle-counts"] }); }} />
      )}

      {viewing && <CycleCountDetail count={viewing} onClose={() => setViewing(null)} />}

      {counting && (
        <CountSubmitModal
          count={counting}
          onClose={() => setCounting(null)}
          onSaved={() => { setCounting(null); queryClient.invalidateQueries({ queryKey: ["cycle-counts"] }); queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["locations"] }); }}
        />
      )}
    </div>
  );
}

function CycleCountForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [location_id, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([{ product_id: "" }]);
  const [saving, setSaving] = useState(false);
  const [expectedByProduct, setExpectedByProduct] = useState<Record<number, number>>({});
  const [locationProducts, setLocationProducts] = useState<{ product_id: number; label: string }[]>([]);
  const { addToast } = useToast();
  const productList = useSelectableProducts();
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
  }, []);

  useEffect(() => {
    if (!location_id) {
      setExpectedByProduct({});
      setLocationProducts([]);
      return;
    }
    api
      .get(`/locations/${location_id}/detail`)
      .then(({ data }) => {
        const map: Record<number, number> = {};
        const productMap: Record<number, string> = {};
        const serializedIds = new Set((data.serials || []).map((s: { product_id: number }) => s.product_id));
        for (const sl of data.stock_lines) {
          map[sl.product_id] = (map[sl.product_id] || 0) + sl.quantity;
          productMap[sl.product_id] = `${sl.product_name}${sl.sku ? ` (${sl.sku})` : ""}`;
        }
        for (const s of data.serials || []) {
          map[s.product_id] = (map[s.product_id] || 0) + 1;
          if (!productMap[s.product_id]) {
            productMap[s.product_id] = `${s.product_name}${s.sku ? ` (${s.sku})` : ""}`;
          }
        }
        setExpectedByProduct(map);
        setLocationProducts(
          Object.entries(productMap)
            .map(([id, label]) => ({
              product_id: Number(id),
              label: serializedIds.has(Number(id)) ? `${label} (Serialized)` : label,
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
        );
      })
      .catch(() => {
        setExpectedByProduct({});
        setLocationProducts([]);
      });
  }, [location_id]);

  const expectedQty = (productId: string) => (productId ? expectedByProduct[Number(productId)] ?? 0 : 0);

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location_id) {
      addToast("Select a location", "error");
      return;
    }
    const items = rows
      .filter((r) => r.product_id)
      .map((r) => ({
        product_id: Number(r.product_id),
        expected_qty: expectedQty(r.product_id),
      }));
    if (items.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/cycle-counts", {
        location_id: Number(location_id),
        notes: notes.trim(),
        items,
      });
      addToast(`Cycle count ${data.cc_number} created`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error creating cycle count", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="New Cycle Count" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="cc-location">Location</label>
            <select id="cc-location" className="select" value={location_id} onChange={(e) => setLocationId(e.target.value)} required>
              <option value="">Select location...</option>
              {locations.filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path)).map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-app px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Items to Count</span>
            <button type="button" onClick={() => setRows([...rows, { product_id: "" }])} className="btn-secondary text-xs py-1 px-2">
              <Plus size={14} className="inline mr-1" />Add Item
            </button>
          </div>
          <div className="divide-y divide-border max-h-[40vh] overflow-auto">
            {rows.map((row, idx) => (
              <div key={idx} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
                <div className="sm:col-span-7">
                  <label className="block text-xs font-medium text-muted mb-1" htmlFor={`cc-product-${idx}`}>Product</label>
                  <select id={`cc-product-${idx}`} className="select" value={row.product_id} onChange={(e) => setRow(idx, "product_id", e.target.value)}>
                    <option value="">Select...</option>
                    {location_id
                      ? locationProducts.map((p) => <option key={p.product_id} value={p.product_id}>{p.label}</option>)
                      : productList.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-muted mb-1">Expected (system)</label>
                  <input type="number" className="input bg-subtle" value={expectedQty(row.product_id)} readOnly />
                </div>
                <div className="sm:col-span-2">
                  <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove item">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">Expected quantity is read from system stock at the selected location. Count the actual on-hand and record only the counted quantity.</p>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !location_id} className="btn-primary">{saving ? "Creating..." : "Create Count"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CycleCountDetail({ count, onClose }: { count: CycleCount; onClose: () => void }) {
  const formatDate = useDateFormat();
  return (
    <Modal open onClose={onClose} title={`Cycle Count ${count.cc_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted">Location</p>
            <p className="font-medium">{count.location_name || "All locations"}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p className="font-medium capitalize">{count.status}</p>
          </div>
          <div>
            <p className="text-muted">Completed</p>
            <p className="font-medium">{count.completed_at ? formatDate(count.completed_at) : "—"}</p>
          </div>
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Product</th>
                <th className="px-4 py-2 font-medium text-muted">Expected</th>
                <th className="px-4 py-2 font-medium text-muted">Counted</th>
                <th className="px-4 py-2 font-medium text-muted">Variance</th>
                <th className="px-4 py-2 font-medium text-muted">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {count.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}</td>
                  <td className="px-4 py-2">{item.expected_qty}</td>
                  <td className="px-4 py-2">{item.counted_qty ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={item.variance !== 0 ? "text-orange-600 dark:text-orange-400 font-medium" : "text-muted"}>
                      {item.variance !== 0 && item.variance > 0 ? "+" : ""}{item.variance}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`badge ${item.status === "ok" ? "badge-success" : item.status === "mismatch" ? "badge-warning" : "badge-info"}`}>{item.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function CountSubmitModal({ count, onClose, onSaved }: { count: CycleCount; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(
    count.items.map((i) => ({ product_id: i.product_id, counted_qty: i.counted_qty != null ? i.counted_qty.toString() : i.expected_qty.toString() }))
  );
  const [saving, setSaving] = useState(false);
  const [onHandNow, setOnHandNow] = useState<Record<number, number>>({});
  const { addToast } = useToast();

  useEffect(() => {
    if (count.location_id == null) return;
    api
      .get(`/locations/${count.location_id}/detail`)
      .then(({ data }) => {
        const map: Record<number, number> = {};
        for (const sl of data.stock_lines || []) map[sl.product_id] = (map[sl.product_id] || 0) + sl.quantity;
        for (const s of data.serials || []) map[s.product_id] = (map[s.product_id] || 0) + 1;
        setOnHandNow(map);
      })
      .catch(() => setOnHandNow({}));
  }, [count.location_id]);

  const changedItems = count.items.filter((item) => {
    const now = onHandNow[item.product_id];
    return now != null && now !== item.expected_qty;
  });

  const setRow = (idx: number, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, counted_qty: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post(`/cycle-counts/${count.id}/submit`, {
        items: rows.map((r) => ({ product_id: r.product_id, counted_qty: parseInt(r.counted_qty) || 0 })),
      });
      const submitDrift = (data.items || []).filter(
        (i: { current_on_hand?: number | null; expected_qty: number }) =>
          i.current_on_hand != null && i.current_on_hand !== i.expected_qty
      );
      if (submitDrift.length > 0) {
        addToast(`On-hand changed for ${submitDrift.length} item(s) since this count was created — verify the counted quantities.`, "info");
      }
      addToast(data.status === "completed" ? "Cycle count completed" : "Count saved", "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error submitting count", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Count ${count.cc_number}`} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {changedItems.length > 0 && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">System on-hand changed since this count was created</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/80">
              {changedItems.map((item) => `${item.product_name}: expected ${item.expected_qty}, on hand now ${onHandNow[item.product_id]}`).join("  ·  ")}
            </p>
          </div>
        )}
        <div className="divide-y divide-border border border-border rounded-lg max-h-[50vh] overflow-auto">
          {count.items.map((item, idx) => {
            const row = rows[idx];
            const variance = (parseInt(row?.counted_qty) || 0) - item.expected_qty;
            const now = onHandNow[item.product_id];
            const onHandChanged = now != null && now !== item.expected_qty;
            return (
              <div key={item.id} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-center">
                <div className="sm:col-span-5">
                  <p className="text-sm font-medium">{item.product_name}</p>
                </div>
                <div className="sm:col-span-2 text-sm text-muted">
                  Expected: {item.expected_qty}
                  {onHandChanged && (
                    <span className={`block text-xs font-medium ${onHandChanged ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      On hand now: {now}
                    </span>
                  )}
                </div>
                <div className="sm:col-span-3">
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={row?.counted_qty ?? ""}
                    onChange={(e) => setRow(idx, e.target.value)}
                    aria-label={`Counted quantity for ${item.product_name}`}
                  />
                </div>
                <div className="sm:col-span-2 text-sm">
                  {variance !== 0 && (
                    <span className={variance > 0 ? "text-orange-600 dark:text-orange-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                      {variance > 0 ? "+" : ""}{variance}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted">Variance is posted to inventory as a COUNT adjustment when submitted.</p>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Submitting..." : "Submit Count"}</button>
        </div>
      </form>
    </Modal>
  );
}
