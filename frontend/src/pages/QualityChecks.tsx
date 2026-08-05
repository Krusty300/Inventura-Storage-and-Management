import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Lot, PaginatedResponse, QualityCheck } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 25;

export default function QualityChecks() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QualityCheck | null>(null);
  const [viewing, setViewing] = useState<QualityCheck | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["quality-checks", page, pageSize],
    queryFn: async () => {
      const { data } = await api.get("/quality-checks", { params: { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() } });
      return data as PaginatedResponse<QualityCheck>;
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

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Quality checks table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3 font-medium text-muted">QC #</th>
              <th className="px-4 py-3 font-medium text-muted">Product</th>
              <th className="px-4 py-3 font-medium text-muted">Batch</th>
              <th className="px-4 py-3 font-medium text-muted">Lot</th>
              <th className="px-4 py-3 font-medium text-muted">Result</th>
              <th className="px-4 py-3 font-medium text-muted">Checked By</th>
              <th className="px-4 py-3 font-medium text-muted">Date</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={8} />
            ) : checks.length === 0 ? (
              <EmptyState title="No quality checks yet" message="Record a QC result to keep lot quality controlled. Failing a check quarantines its lot." actionLabel={can("quality_checks.create") ? "New Check" : undefined} onAction={can("quality_checks.create") ? () => { setEditing(null); setShowForm(true); } : undefined} />
            ) : checks.map((qc) => (
              <tr key={qc.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{qc.qc_number}</td>
                <td className="px-4 py-3 text-muted">{qc.product_name}</td>
                <td className="px-4 py-3 text-muted">{qc.batch_number || "—"}</td>
                <td className="px-4 py-3 text-muted">{qc.lot_number || "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${resultBadge(qc.result)}`}>{qc.result}</span></td>
                <td className="px-4 py-3 text-muted">{qc.checker_username}</td>
                <td className="px-4 py-3 text-muted">{qc.checked_at ? new Date(qc.checked_at).toLocaleDateString() : new Date(qc.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(qc)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${qc.qc_number}`}><Eye size={16} /></button>
                    {can("quality_checks.update") && (
                      <button onClick={() => { setEditing(qc); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${qc.qc_number}`}><Pencil size={16} /></button>
                    )}
                    {can("quality_checks.delete") && (
                      <button onClick={() => deleteCheck(qc)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${qc.qc_number}`}><Trash2 size={16} /></button>
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
        <QualityCheckForm
          qc={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && <QualityCheckDetail qc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );

  async function deleteCheck(qc: QualityCheck) {
    if (!confirm(`Delete quality check ${qc.qc_number}?`)) return;
    try {
      await api.delete(`/quality-checks/${qc.id}`);
      refresh();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Error deleting quality check");
    }
  }
}

function QualityCheckForm({ qc, onClose, onSaved }: { qc: QualityCheck | null; onClose: () => void; onSaved: () => void }) {
  const products = useSelectableProducts().filter((p) => !p.is_serialized);
  const [productId, setProductId] = useState(qc ? String(qc.product_id) : "");
  const [lotId, setLotId] = useState(qc?.lot_id ? String(qc.lot_id) : "");
  const [lots, setLots] = useState<Lot[]>([]);
  const [batchNumber, setBatchNumber] = useState(qc?.batch_number || "");
  const [result, setResult] = useState(qc?.result || "pass");
  const [notes, setNotes] = useState(qc?.notes || "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (!productId) {
      setLots([]);
      setLotId("");
      return;
    }
    api.get("/lots", { params: { product_id: productId, limit: 200 } }).then(({ data }) => setLots(data.items));
  }, [productId]);

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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product</label>
            <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!!qc} required>
              <option value="">Select product...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
            <select className="select" value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!!qc}>
              <option value="">No lot / all lots</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} ({l.on_hand} on hand){l.status !== "in_stock" ? ` [${l.status}]` : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Batch Number</label>
            <input className="input" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} disabled={!!qc} placeholder="e.g. B-2026-01" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Result</label>
            <select className="select" value={result} onChange={(e) => setResult(e.target.value)}>
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
  return (
    <Modal open onClose={onClose} title={qc.qc_number}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
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
              <p className="font-medium">{new Date(qc.checked_at).toLocaleString()}</p>
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
