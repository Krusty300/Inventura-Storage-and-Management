import { useDateFormat } from "../hooks/useDateFormat";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2, Search, ShieldCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE } from "../utils/constants";
import { statusBadge } from "../utils/statusBadges";
import type { Lot, PaginatedResponse, QualityCheck } from "../types";
import SlideOver from "../components/SlideOver";
import ConfirmDialog from "../components/ConfirmDialog";
import AttachmentSection from "../components/AttachmentSection";
import TextArea from "../components/TextArea";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Table from "../components/Table";
import ErrorState from "../components/ErrorState";
import { useDebounce } from "../hooks/useDebounce";
import FittedSelect from "../components/FittedSelect";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";

export default function QualityChecks() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [result, setResult] = useState("");
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

  const { data, isLoading, isError } = useQuery({
    queryKey: ["quality-checks", debouncedSearch, result, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (result) params.result = result;
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
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Error deleting quality check"), "error");
    },
  });

  const checks = data?.items || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["quality-checks"] });
    queryClient.invalidateQueries({ queryKey: ["exceptions"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "exceptions"] });
  };

  const resultBadge = (r: string) =>
    r === "pass" ? "badge-success" : r === "fail" ? "badge-danger" : "badge-warning";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ShieldCheck size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Quality Checks</h1>
            <p className="text-sm text-muted mt-1">Inspect and approve incoming and outgoing lots.</p>
          </div>
        </div>
        {can("quality_checks.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            New Check
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by QC number, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search quality checks" />
        </div>
        <FittedSelect value={result} onChange={(v) => { setResult(v); setPage(1); }} ariaLabel="Filter by result" options={[{ value: "", label: "All results" }, { value: "pending", label: "Pending" }, { value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} />
      </div>

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Quality checks table"
          role="grid"
          columns={[
            { key: "qc", header: "QC #" },
            { key: "product", header: "Product" },
            { key: "batch", header: "Batch" },
            { key: "lot", header: "Lot" },
            { key: "location", header: "Location" },
            { key: "result", header: "Result" },
            { key: "checkedBy", header: "Checked By" },
            { key: "date", header: "Date" },
            { key: "actions", header: "Actions" },
          ]}
        >
            {isLoading ? (
              <Skeleton rows={5} cols={9} />
            ) : isError ? (
              <ErrorState onRetry={refresh} />
            ) : checks.length === 0 ? (
              <EmptyState icon={<ShieldCheck size={48} />} title={search || result ? "No matching quality checks" : "No quality checks yet"} message={search || result ? "Nothing matched your search or filters. Try adjusting them." : "Record a QC result to keep stock quality controlled. Failing a check quarantines its lot when one is linked and blocks the affected stock until resolved."} actionLabel={search || result ? undefined : can("quality_checks.create") ? "New Check" : undefined} onAction={search || result ? undefined : can("quality_checks.create") ? () => { setEditing(null); setShowForm(true); } : undefined} />
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
                    <button onClick={() => setViewing(qc)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View ${qc.qc_number}`}><Eye size={16} /></button>
                    {can("quality_checks.update") && (
                      <button onClick={() => { setEditing(qc); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${qc.qc_number}`}><Pencil size={16} /></button>
                    )}
                    {can("quality_checks.delete") && (
                      <button onClick={() => setDeleting(qc)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${qc.qc_number}`}><Trash2 size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </Table>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {showForm && (
        <QualityCheckForm
          qc={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && (
        <QualityCheckDetail
          qc={viewing}
          onClose={() => setViewing(null)}
          onEdit={can("quality_checks.update") ? () => { setEditing(viewing); setShowForm(true); setViewing(null); } : undefined}
        />
      )}

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
  const [batchNumber, setBatchNumber] = useState(qc?.batch_number || "");
  const [result, setResult] = useState(qc?.result || "pass");
  const [notes, setNotes] = useState(qc?.notes || "");
  const [workOrderId, setWorkOrderId] = useState(qc?.work_order_id ? String(qc.work_order_id) : "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const selectedProduct = products.find((p) => p.id === Number(productId));
  const stockLocations = useProductStockLocations(productId ? Number(productId) : null, selectedProduct?.is_serialized ?? false);

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ["lots", "by-product", productId],
    queryFn: async () => (await api.get("/lots", { params: { product_id: productId, limit: PAGE_SIZE } })).data.items,
    enabled: !!productId,
  });

  const { data: workOrders = [] } = useQuery<{ id: number; wo_number: string; status: string }[]>({
    queryKey: ["work-orders", "qc", productId],
    queryFn: async () => {
      const { data } = await api.get("/work-orders", { params: { product_id: productId, limit: 100 } });
      return (data?.items || []).filter((w: { status: string }) => w.status !== "cancelled");
    },
    enabled: !!productId && !qc,
  });

  useEffect(() => {
    if (!productId) {
      setLotId("");
      setLocationId("");
      return;
    }
    if (!qc) setLocationId("");
  }, [productId, qc]);

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
      if (workOrderId) payload.work_order_id = Number(workOrderId);
      if (qc) {
        await api.put(`/quality-checks/${qc.id}`, { result, notes: notes.trim() });
        addToast(`Quality check ${qc.qc_number} updated`, "success");
      } else {
        const { data } = await api.post("/quality-checks", payload);
        addToast(`Quality check ${data.qc_number} recorded`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving quality check"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={qc ? `Edit ${qc.qc_number}` : "New Quality Check"} wide ariaLabel={qc ? `Edit ${qc.qc_number}` : "New Quality Check"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product</label>
            <FittedSelect
              ariaLabel="QC product"
              value={productId}
              onChange={setProductId}
              disabled={!!qc}
              placeholder="Select product..."
              options={[
                { value: "", label: "Select product..." },
                ...products.map((p) => ({ value: String(p.id), label: `${productLabel(p)}${p.is_serialized ? " (Serialized)" : ""}` })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
            <FittedSelect
              ariaLabel="QC lot"
              value={lotId}
              onChange={setLotId}
              disabled={!!qc}
              placeholder="No lot / all lots"
              options={[
                { value: "", label: "No lot / all lots" },
                ...visibleLots.map((l) => ({ value: String(l.id), label: `${l.lot_number} (${(selectedProduct?.is_serialized ? l.serial_count : l.on_hand)} on hand)${l.status !== "in_stock" ? ` [${l.status}]` : ""}` })),
              ]}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Location (optional)</label>
            <FittedSelect
              ariaLabel="QC location"
              value={locationId}
              onChange={(v) => { setLocationId(v); setLotId(""); }}
              disabled={!!qc}
              placeholder="All locations"
              options={[
                { value: "", label: "All locations" },
                ...stockLocations.locations.map((l) => ({ value: String(l.location_id), label: `${l.path} (${l.count} on hand)` })),
              ]}
            />
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
        {!qc && workOrders.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Work Order (optional)</label>
            <FittedSelect
              ariaLabel="Work order"
              value={workOrderId}
              onChange={setWorkOrderId}
              options={workOrders.map((w) => ({
                value: String(w.id),
                label: `${w.wo_number} (${w.status.replace(/_/g, " ")})`,
              }))}
              placeholder="No work order"
            />
            <p className="text-xs text-faint mt-1">Link this QC to a work order that produced the lot being inspected.</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Result</label>
            <FittedSelect ariaLabel="QC result" value={result} onChange={setResult} options={[{ value: "pending", label: "Pending" }, { value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <TextArea rows={2} value={notes} onChange={setNotes} />
        </div>
        {result === "fail" && (
          <p className="text-xs text-orange-600 dark:text-orange-400">
            {lotId
              ? "Failing this check quarantines the linked lot and blocks sales/shipments drawn from the affected scope until the check is updated or deleted."
              : `Failing this check blocks sales and shipments of this product${locationId ? " from the selected location" : ""} until the check is updated or deleted.`}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !productId} className="btn-primary">{saving ? "Saving..." : "Save Check"}</button>
        </div>
      </form>
    </SlideOver>
  );
}

function QualityCheckDetail({ qc, onClose, onEdit }: { qc: QualityCheck; onClose: () => void; onEdit?: () => void }) {
  const formatDateTime = useDateTimeFormat();
  const { can } = useAuth();
  const headerActions = onEdit ? (
    <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label={`Edit ${qc.qc_number}`}>
      <Pencil size={14} />Edit Check
    </button>
  ) : undefined;
  return (
    <SlideOver open onClose={onClose} title={qc.qc_number} wide ariaLabel={`Quality check ${qc.qc_number} details`} actions={headerActions}>
      <div className="space-y-5">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">Quality Check Report</p>
              <h3 className="text-2xl font-bold text-ink mt-1 tracking-tight">{qc.qc_number}</h3>
            </div>
            <div className="text-right text-sm">
              <span className={`badge ${statusBadge(qc.result)}`}>{qc.result}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 px-6 py-5 text-sm">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Product</p>
              <p className="font-medium text-ink">{qc.product_name}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Batch Number</p>
              <p className="font-medium text-ink">{qc.batch_number || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Lot</p>
              <p className="font-medium text-ink">{qc.lot_number || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Location</p>
              <p className="font-medium text-ink">{qc.location_name || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Work Order</p>
              <p className="font-medium text-ink">{qc.wo_number || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Checked By</p>
              <p className="font-medium text-ink">{qc.checker_username}</p>
            </div>
            {qc.checked_at && (
              <div>
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Checked At</p>
                <p className="font-medium text-ink">{formatDateTime(qc.checked_at)}</p>
              </div>
            )}
          </div>

          {qc.notes && (
            <div className="px-6 pb-5 text-sm">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted">{qc.notes}</p>
            </div>
          )}
        </div>
        <AttachmentSection entityType="quality_check" entityId={qc.id} canEdit={can("quality_checks.update")} />
      </div>
    </SlideOver>
  );
}
