import { useDateFormat } from "../hooks/useDateFormat";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE } from "../utils/constants";
import type { Lot, PaginatedResponse, QualityCheck } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";

export default function QualityChecks() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [editing, setEditing] = useState<QualityCheck | null>(null);
  const [viewing, setViewing] = useState<QualityCheck | null>(null);
  const [deleting, setDeleting] = useState<QualityCheck | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["quality-checks", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/quality-checks", { params });
      return data as PaginatedResponse<QualityCheck>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/quality-checks/${id}`),
    onSuccess: () => {
      addToast("Quality check deleted", "success");
      refresh();
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Error deleting quality check", "error");
    },
  });

  const checks = data?.items || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["quality-checks"] });
    queryClient.invalidateQueries({ queryKey: ["exceptions"] });
  };

  const resultBadge = (r: string) =>
    r === "pass" ? "badge-success" : r === "fail" ? "badge-danger" : "badge-warning";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Quality Checks</h1>
        {can("quality_checks.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            New Check
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by QC number, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search quality checks" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Quality checks table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">QC #</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Batch</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Lot</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Location</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Result</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Checked By</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Date</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={9} />
            ) : checks.length === 0 ? (
              <EmptyState title="No quality checks yet" message="Record a QC result to keep lot quality controlled. Failing a check quarantines its lot." actionLabel={can("quality_checks.create") ? "New Check" : undefined} onAction={can("quality_checks.create") ? () => { setEditing(null); setShowForm(true); } : undefined} />
            ) : checks.map((qc) => (
              <tr key={qc.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{qc.qc_number}</td>
                <td className="px-4 py-3 text-muted">{qc.product_name}</td>
                <td className="px-4 py-3 text-muted">{qc.batch_number || "—"}</td>
                <td className="px-4 py-3 text-muted">{qc.lot_number || "—"}</td>
                <td className="px-4 py-3 text-muted">{qc.location_name || "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${resultBadge(qc.result)}`}>{qc.result}</span></td>
                <td className="px-4 py-3 text-muted">{qc.checker_username}</td>
                <td className="px-4 py-3 text-muted">{qc.checked_at ? formatDate(qc.checked_at) : formatDate(qc.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(qc)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${qc.qc_number}`}><Eye size={16} /></button>
                    {can("quality_checks.update") && (
                      <button onClick={() => { setEditing(qc); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${qc.qc_number}`}><Pencil size={16} /></button>
                    )}
                    {can("quality_checks.delete") && (
                      <button onClick={() => setDeleting(qc)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${qc.qc_number}`}><Trash2 size={16} /></button>
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
        <QualityCheckForm
          qc={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && <QualityCheckDetail qc={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Quality Check"
        message={`Are you sure you want to delete quality check ${deleting?.qc_number}? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function QualityCheckForm({ qc, onClose, onSaved }: { qc: QualityCheck | null; onClose: () => void; onSaved: () => void }) {
  const products = useSelectableProducts();
  const [productId, setProductId] = useState(qc ? String(qc.product_id) : "");
  const [lotId, setLotId] = useState(qc?.lot_id ? String(qc.lot_id) : "");
  const [locationId, setLocationId] = useState(qc?.location_id ? String(qc.location_id) : "");
  const [lots, setLots] = useState<Lot[]>([]);
  const [batchNumber, setBatchNumber] = useState(qc?.batch_number || "");
  const [result, setResult] = useState(qc?.result || "pass");
  const [notes, setNotes] = useState(qc?.notes || "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const selectedProduct = products.find((p) => p.id === Number(productId));
  const stockLocations = useProductStockLocations(productId ? Number(productId) : null, selectedProduct?.is_serialized ?? false);

  useEffect(() => {
    if (!productId) {
      setLots([]);
      setLotId("");
      setLocationId("");
      return;
    }
    api.get("/lots", { params: { product_id: productId, limit: PAGE_SIZE } }).then(({ data }) => setLots(data.items));
    if (!qc) setLocationId("");
  }, [productId]);

  const selectedLocation = stockLocations.locations.find((l) => l.location_id === Number(locationId));
  const visibleLots = selectedLocation ? lots.filter((l) => l.locations?.includes(selectedLocation.path)) : lots;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      addToast("Select a product", "error");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        product_id: Number(productId),
        batch_number: batchNumber.trim(),
        result,
        notes: notes.trim(),
      };
      if (lotId) payload.lot_id = Number(lotId);
      if (locationId) payload.location_id = Number(locationId);
      if (qc) {
        await api.put(`/quality-checks/${qc.id}`, { result, notes: notes.trim() });
        addToast(`Quality check ${qc.qc_number} updated`, "success");
      } else {
        const { data } = await api.post("/quality-checks", payload);
        addToast(`Quality check ${data.qc_number} recorded`, "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving quality check", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={qc ? `Edit ${qc.qc_number}` : "New Quality Check"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product</label>
            <select className="select" aria-label="QC product" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!!qc} required>
              <option value="">Select product...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}{p.is_serialized ? " (Serialized)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
            <select className="select" aria-label="QC lot" value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!!qc}>
              <option value="">No lot / all lots</option>
              {visibleLots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} ({(selectedProduct?.is_serialized ? l.serial_count : l.on_hand)} on hand){l.status !== "in_stock" ? ` [${l.status}]` : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Location (optional)</label>
            <select className="select" aria-label="QC location" value={locationId} onChange={(e) => { setLocationId(e.target.value); setLotId(""); }} disabled={!!qc}>
              <option value="">All locations</option>
              {stockLocations.locations.map((l) => <option key={l.location_id} value={l.location_id}>{l.path} ({l.count} on hand)</option>)}
            </select>
            <p className="text-xs text-faint mt-1">
              {stockLocations.locations.length === 0
                ? "No stock locations found for this product."
                : "Pick a location to narrow the lot list to stock held there."}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Batch Number</label>
            <input className="input" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} disabled={!!qc} placeholder="e.g. B-2026-01" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Result</label>
            <select className="select" aria-label="QC result" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="pending">Pending</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {result === "fail" && (
          <p className="text-xs text-orange-600 dark:text-orange-400">
            {lotId
              ? "Failing this check will quarantine the linked lot."
              : "Failing without a linked lot will block shipments for this product until the check is updated or deleted."}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !productId} className="btn-primary">{saving ? "Saving..." : "Save Check"}</button>
        </div>
      </form>
    </Modal>
  );
}

function QualityCheckDetail({ qc, onClose }: { qc: QualityCheck; onClose: () => void }) {
  const formatDateTime = useDateTimeFormat();
  return (
    <Modal open onClose={onClose} title={qc.qc_number}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-muted">Product</p>
            <p className="font-medium">{qc.product_name}</p>
          </div>
          <div>
            <p className="text-muted">Result</p>
            <p className="font-medium capitalize">{qc.result}</p>
          </div>
          <div>
            <p className="text-muted">Batch Number</p>
            <p className="font-medium">{qc.batch_number || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Lot</p>
            <p className="font-medium">{qc.lot_number || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Location</p>
            <p className="font-medium">{qc.location_name || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Work Order</p>
            <p className="font-medium">{qc.wo_number || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Checked By</p>
            <p className="font-medium">{qc.checker_username}</p>
          </div>
          {qc.checked_at && (
            <div>
              <p className="text-muted">Checked At</p>
              <p className="font-medium">{formatDateTime(qc.checked_at)}</p>
            </div>
          )}
          {qc.notes && (
            <div className="col-span-2">
              <p className="text-muted">Notes</p>
              <p className="font-medium">{qc.notes}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}
