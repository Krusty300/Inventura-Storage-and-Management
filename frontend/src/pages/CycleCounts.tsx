import { useEffect, useState } from "react";
import { Eye, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { CycleCount, Location, PaginatedResponse } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 25;

export default function CycleCounts() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<CycleCount | null>(null);
  const [counting, setCounting] = useState<CycleCount | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["cycle-counts", page, pageSize],
    queryFn: async () => {
      const { data } = await api.get("/cycle-counts", { params: { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() } });
      return data as PaginatedResponse<CycleCount>;
    },
  });

  const counts = data?.items || [];

  const statusBadge = (s: string) =>
    s === "completed" ? "badge-success" : s === "in_progress" ? "badge-info" : s === "cancelled" ? "badge-danger" : "badge-warning";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Cycle Counts</h1>
        {can("cycle_counts.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            New Count
          </button>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Cycle counts table">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Count #</th>
              <th className="px-4 py-3 font-medium text-gray-600">Location</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 font-medium text-gray-600">Expected</th>
              <th className="px-4 py-3 font-medium text-gray-600">Variance</th>
              <th className="px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : counts.length === 0 ? (
              <EmptyState title="No cycle counts yet" message="Create a cycle count to verify on-hand stock against the system." actionLabel="New Count" onAction={() => setShowForm(true)} />
            ) : counts.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{c.cc_number}</td>
                <td className="px-4 py-3 text-gray-500">{c.location_name || "All"}</td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(c.status)}`}>{c.status}</span></td>
                <td className="px-4 py-3">{c.total_expected}</td>
                <td className="px-4 py-3">
                  <span className={c.total_variance !== 0 ? "text-orange-600 font-medium" : "text-gray-500"}>
                    {c.total_variance > 0 ? "+" : ""}{c.total_variance}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(c)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View ${c.cc_number}`}><Eye size={16} /></button>
                    {c.status !== "completed" && c.status !== "cancelled" && can("cycle_counts.count") && (
                      <button onClick={() => setCounting(c)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Count ${c.cc_number}`}><ClipboardCheck size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          onSaved={() => { setCounting(null); queryClient.invalidateQueries({ queryKey: ["cycle-counts"] }); queryClient.invalidateQueries({ queryKey: ["products"] }); }}
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
  const { addToast } = useToast();
  const productList = useSelectableProducts().filter((p) => !p.is_serialized);
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
  }, []);

  useEffect(() => {
    if (!location_id) {
      setExpectedByProduct({});
      return;
    }
    api
      .get(`/locations/${location_id}/detail`)
      .then(({ data }) => {
        const map: Record<number, number> = {};
        for (const sl of data.stock_lines) {
          map[sl.product_id] = (map[sl.product_id] || 0) + sl.quantity;
        }
        setExpectedByProduct(map);
      })
      .catch(() => setExpectedByProduct({}));
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <select className="select" value={location_id} onChange={(e) => setLocationId(e.target.value)} required>
              <option value="">Select location...</option>
              {locations.filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path)).map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Items to Count</span>
            <button type="button" onClick={() => setRows([...rows, { product_id: "" }])} className="btn-secondary text-xs py-1 px-2">
              <Plus size={14} className="inline mr-1" />Add Item
            </button>
          </div>
          <div className="divide-y divide-gray-100 max-h-[40vh] overflow-auto">
            {rows.map((row, idx) => (
              <div key={idx} className="p-4 grid grid-cols-12 gap-2 items-end">
                <div className="col-span-7">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
                  <select className="select" value={row.product_id} onChange={(e) => setRow(idx, "product_id", e.target.value)}>
                    <option value="">Select...</option>
                    {productList.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expected (system)</label>
                  <input type="number" className="input bg-gray-100" value={expectedQty(row.product_id)} readOnly />
                </div>
                <div className="col-span-2">
                  <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove item">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500">Expected quantity is read from system stock at the selected location. Count the actual on-hand and record only the counted quantity.</p>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !location_id} className="btn-primary">{saving ? "Creating..." : "Create Count"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CycleCountDetail({ count, onClose }: { count: CycleCount; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Cycle Count ${count.cc_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Location</p>
            <p className="font-medium">{count.location_name || "All locations"}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className="font-medium capitalize">{count.status}</p>
          </div>
          <div>
            <p className="text-gray-500">Completed</p>
            <p className="font-medium">{count.completed_at ? new Date(count.completed_at).toLocaleDateString() : "—"}</p>
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Product</th>
                <th className="px-4 py-2 font-medium text-gray-600">Expected</th>
                <th className="px-4 py-2 font-medium text-gray-600">Counted</th>
                <th className="px-4 py-2 font-medium text-gray-600">Variance</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {count.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}</td>
                  <td className="px-4 py-2">{item.expected_qty}</td>
                  <td className="px-4 py-2">{item.counted_qty ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={item.variance !== 0 ? "text-orange-600 font-medium" : "text-gray-500"}>
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
  const { addToast } = useToast();

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
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg max-h-[50vh] overflow-auto">
          {count.items.map((item, idx) => {
            const row = rows[idx];
            const variance = (parseInt(row?.counted_qty) || 0) - item.expected_qty;
            return (
              <div key={item.id} className="p-4 grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <p className="text-sm font-medium">{item.product_name}</p>
                </div>
                <div className="col-span-2 text-sm text-gray-500">
                  Expected: {item.expected_qty}
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={row?.counted_qty ?? ""}
                    onChange={(e) => setRow(idx, e.target.value)}
                    aria-label={`Counted quantity for ${item.product_name}`}
                  />
                </div>
                <div className="col-span-2 text-sm">
                  {variance !== 0 && (
                    <span className={variance > 0 ? "text-orange-600 font-medium" : "text-red-600 font-medium"}>
                      {variance > 0 ? "+" : ""}{variance}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">Variance is posted to inventory as a COUNT adjustment when submitted.</p>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Submitting..." : "Submit Count"}</button>
        </div>
      </form>
    </Modal>
  );
}
