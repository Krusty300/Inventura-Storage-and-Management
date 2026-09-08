import { useDateFormat } from "../hooks/useDateFormat";
import { statusBadge } from "../utils/statusBadges";
import { useState } from "react";
import { Columns3, CheckCircle, Factory, Eye, List, Pencil, Play, Plus, Printer, Rocket, Search, XCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { BOM, Location, PaginatedResponse, WorkOrder, WorkOrderCost, WorkOrderGenealogy } from "../types";
import Modal from "../components/Modal";
import SlideOver from "../components/SlideOver";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import ProgressBar from "../components/ProgressBar";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import FittedSelect from "../components/FittedSelect";
import ScrollArea from "../components/ScrollArea";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";

type ViewMode = "list" | "kanban";

const KANBAN_COLUMNS: { key: string; label: string }[] = [
  { key: "planned", label: "Planned" },
  { key: "released", label: "Released" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const WORKFLOW_ORDER = ["planned", "released", "in_progress", "completed", "cancelled"];

const COLUMN_DOT: Record<string, string> = {
  planned: "bg-sky-500",
  released: "bg-violet-500",
  in_progress: "bg-primary",
  completed: "bg-emerald-500",
  cancelled: "bg-red-500",
};

export default function WorkOrders() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [statusFilter, setStatusFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [viewing, setViewing] = useState<WorkOrder | null>(null);
  const [completing, setCompleting] = useState<WorkOrder | null>(null);
  const [draggedWo, setDraggedWo] = useState<WorkOrder | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["work-orders", debouncedSearch, statusFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      const { data } = await api.get("/work-orders", { params });
      return data as PaginatedResponse<WorkOrder>;
    },
  });

  const wos = data?.items || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    queryClient.invalidateQueries({ queryKey: ["work-orders-kanban"] });
    queryClient.invalidateQueries({ queryKey: ["work-order"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const { data: kanbanData, isLoading: kanbanLoading } = useQuery({
    queryKey: ["work-orders-kanban", debouncedSearch],
    queryFn: async () => {
      const { data } = await api.get("/work-orders/kanban", { params: debouncedSearch ? { search: debouncedSearch } : {} });
      return data as { items: WorkOrder[]; total: number; by_status: Record<string, number> };
    },
    enabled: viewMode === "kanban",
  });
  const kanbanWos = kanbanData?.items ?? [];
  const kanbanCounts = kanbanData?.by_status ?? {};
  const kanbanTotal = kanbanData?.total ?? kanbanWos.length;

  const priorityBadge = (p: string) =>
    p === "high" ? "badge-danger" : p === "low" ? "badge-success" : "badge-info";

  const run = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      addToast(msg, "success");
      refresh();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Action failed"), "error");
    }
  };

  const printPdf = async (w: WorkOrder) => {
    try {
      const { data } = await api.get(`/work-orders/${w.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  const handleDragStart = (e: React.DragEvent, w: WorkOrder) => {
    setDraggedWo(w);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(w.id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    const from = draggedWo;
    setDraggedWo(null);
    if (!from || from.status === targetStatus) return;

    const canTransition = (fromS: string, toS: string) => {
      if (toS === "released") return fromS === "planned";
      if (toS === "in_progress") return fromS === "released";
      if (toS === "completed") return fromS === "released" || fromS === "in_progress";
      if (toS === "cancelled") return ["planned", "released", "in_progress"].includes(fromS);
      return false;
    };

    if (targetStatus === "completed" && canTransition(from.status, targetStatus)) {
      setCompleting(from);
      return;
    }
    if (!canTransition(from.status, targetStatus)) {
      addToast(`Work order ${from.wo_number.replace(/_/g, " ")} cannot move from ${from.status.replace("_", " ")} to ${targetStatus.replace("_", " ")}`, "error");
      return;
    }
    if (targetStatus === "released") {
      run(() => api.post(`/work-orders/${from.id}/release`), `${from.wo_number} released`);
    } else if (targetStatus === "in_progress") {
      run(() => api.post(`/work-orders/${from.id}/start`), `${from.wo_number} started`);
    } else if (targetStatus === "cancelled") {
      run(() => api.post(`/work-orders/${from.id}/cancel`), `${from.wo_number} cancelled`);
    }
  };

  const renderKanbanBoard = () => {
    return (
      <ScrollArea direction="horizontal" viewportClassName="flex gap-4 pb-4 min-h-[400px] sa-viewport-contain">
        {KANBAN_COLUMNS.map((col) => {
          const colWos = kanbanWos.filter((w) => w.status === col.key);
          return (
            <div key={col.key} className="flex-1 min-w-[280px]" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, col.key)}>
              <div className="flex items-center gap-2 px-3 py-2.5 mb-3 rounded-lg bg-subtle border border-border">
                <span className={`w-2 h-2 rounded-full ${COLUMN_DOT[col.key] ?? "bg-faint"}`} aria-hidden="true" />
                <span className="text-sm font-semibold text-ink">{col.label}</span>
                <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-border text-xs font-medium text-muted">{kanbanCounts[col.key] ?? colWos.length}</span>
              </div>
              <div className="p-2 rounded-lg border-2 border-dashed border-transparent hover:border-border transition-colors min-h-[200px]">
                {colWos.length === 0 ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-xs text-faint bg-subtle/30">Drop work orders here</div>
                ) : (
                  <div className="space-y-3">{colWos.map((w) => renderWoCard(w))}</div>
                )}
              </div>
</div>
        );
      })}
      </ScrollArea>
    );
  };

  const renderWoCard = (w: WorkOrder) => {
    const columnIndex = WORKFLOW_ORDER.indexOf(w.status);
    return (
      <div
        key={w.id}
        draggable={can("work_orders.update") || can("work_orders.release")}
        onDragStart={(e) => handleDragStart(e, w)}
        onClick={() => setViewing(w)}
        className={`card p-4 cursor-pointer hover:shadow-md hover:border-primary-soft dark:hover:border-primary/30 transition-[box-shadow,transform,opacity] duration-150 ${draggedWo?.id === w.id ? "opacity-50 scale-[0.98]" : ""}`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <span className="font-semibold text-ink text-sm truncate block">{w.wo_number}</span>
            <span className="text-xs text-faint truncate block">{w.bom_name || "Manual components"}</span>
          </div>
          <span className={`badge ${priorityBadge(w.priority)} shrink-0`}>{w.priority}</span>
        </div>
        <p className="text-xs text-muted truncate mb-3">{w.product_name}</p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted pt-2 border-t border-border">
          <span className="tabular-nums font-medium">Qty {w.quantity}</span>
          {columnIndex >= 1 && columnIndex <= 2 ? (
            <ProgressBar
              value={w.total_issued}
              max={w.total_required}
              tone={!w.fully_issued ? "warning" : undefined}
              label={`Issue progress for ${w.wo_number}`}
            />
          ) : (
            <span className="text-faint">{formatDate(w.created_at)}</span>
          )}
        </div>
      </div>
    );
  };

  const renderKanbanSkeleton = () => (
    <ScrollArea direction="horizontal" viewportClassName="flex gap-4 pb-4 min-h-[400px] sa-viewport-contain">
      {KANBAN_COLUMNS.map((col) => (
        <div key={col.key} className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 px-3 py-2.5 mb-3 rounded-lg bg-subtle border border-border">
            <span className={`w-2 h-2 rounded-full ${COLUMN_DOT[col.key] ?? "bg-faint"}`} aria-hidden="true" />
            <span className="text-sm font-semibold text-ink">{col.label}</span>
            <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-border text-xs font-medium text-muted animate-pulse">—</span>
          </div>
          <div className="space-y-3 p-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card p-4 space-y-2">
                <Skeleton variant="text" className="h-4 w-24" />
                <Skeleton variant="text" className="h-3 w-32" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </ScrollArea>
  );

  const openNew = () => { setEditing(null); setShowForm(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Factory size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink tracking-tight">Work Orders</h1>
            <p className="text-sm text-muted mt-0.5">Plan and track production through completion.</p>
          </div>
        </div>
        {can("work_orders.create") && (
          <button onClick={openNew} className="btn-primary shrink-0">
            <Plus size={16} /> New Work Order
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by work order number, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search work orders" />
        </div>
        <FittedSelect ariaLabel="Filter by status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={[{ value: "", label: "All statuses" }, { value: "planned", label: "Planned" }, { value: "released", label: "Released" }, { value: "in_progress", label: "In Progress" }, { value: "completed", label: "Completed" }, { value: "on_hold", label: "On Hold" }]} />
        <div className="flex items-center gap-1 p-1 rounded-lg bg-subtle w-fit">
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-surface text-primary dark:text-primary shadow-sm" : "text-muted hover:text-ink"}`}
            title="Table view"
            aria-label="Table view"
            aria-pressed={viewMode === "list"}
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setViewMode("kanban")}
            className={`p-1.5 rounded transition-colors ${viewMode === "kanban" ? "bg-surface text-primary dark:text-primary shadow-sm" : "text-muted hover:text-ink"}`}
            title="Kanban view"
            aria-label="Kanban view"
            aria-pressed={viewMode === "kanban"}
          >
            <Columns3 size={16} />
          </button>
        </div>
      </div>

      {viewMode === "kanban" ? (
        kanbanLoading ? (
          renderKanbanSkeleton()
        ) : kanbanWos.length === 0 ? (
          <EmptyState title="No work orders yet" message="Plan a work order to build a product from a BOM or component list." actionLabel="New Work Order" onAction={openNew} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">{kanbanTotal} work {kanbanTotal === 1 ? "order" : "orders"} across the pipeline</p>
            {renderKanbanBoard()}
          </div>
        )
      ) : (
      <>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Work orders table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">WO #</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Qty</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Priority</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Issued</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Created</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={8} />
            ) : isError ? (
              <ErrorState onRetry={refresh} />
            ) : wos.length === 0 ? (
              <EmptyState title="No work orders yet" message="Plan a work order to build a product from a BOM or component list." actionLabel="New Work Order" onAction={openNew} />
            ) : wos.map((w) => (
              <tr key={w.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(w)}>
                <td className="px-4 py-3 font-medium">{w.wo_number}</td>
                <td className="px-4 py-3 text-muted">{w.product_name}</td>
                <td className="px-4 py-3">{w.quantity}</td>
                <td className="px-4 py-3"><span className={`badge ${priorityBadge(w.priority)}`}>{w.priority}</span></td>
                <td className="px-4 py-3">
                  <ProgressBar
                    value={w.total_issued}
                    max={w.total_required}
                    tone={!w.fully_issued && w.status !== "planned" ? "warning" : undefined}
                    label={`Issue progress for ${w.wo_number}`}
                  />
                </td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(w.status)}`}>{w.status.replace("_", " ")}</span></td>
                <td className="px-4 py-3 text-muted">{formatDate(w.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); printPdf(w); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print ${w.wo_number}`}><Printer size={16} /></button>
                    <button onClick={(e) => { e.stopPropagation(); setViewing(w); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${w.wo_number}`}><Eye size={16} /></button>
                    {w.status === "planned" && can("work_orders.update") && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setEditing(w); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${w.wo_number}`}><Pencil size={16} /></button>
                        <button onClick={(e) => { e.stopPropagation(); run(() => api.post(`/work-orders/${w.id}/cancel`), `${w.wo_number} cancelled`); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Cancel ${w.wo_number}`}><XCircle size={16} /></button>
                      </>
                    )}
                    {(w.status === "released" || w.status === "in_progress") && can("work_orders.update") && (
                      <button onClick={(e) => { e.stopPropagation(); run(() => api.post(`/work-orders/${w.id}/cancel`), `${w.wo_number} cancelled`); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Cancel ${w.wo_number}`}><XCircle size={16} /></button>
                    )}
                    {w.status === "planned" && can("work_orders.release") && (
                      <button onClick={(e) => { e.stopPropagation(); run(() => api.post(`/work-orders/${w.id}/release`), `${w.wo_number} released`); }} className="p-1 text-faint hover:text-green-600 dark:text-green-400" aria-label={`Release ${w.wo_number}`}><Rocket size={16} /></button>
                    )}
                    {w.status === "released" && can("work_orders.release") && (
                      <button onClick={(e) => { e.stopPropagation(); run(() => api.post(`/work-orders/${w.id}/start`), `${w.wo_number} started`); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Start ${w.wo_number}`}><Play size={16} /></button>
                    )}
                    {(w.status === "released" || w.status === "in_progress") && can("work_orders.complete") && (
                      <button onClick={(e) => { e.stopPropagation(); setCompleting(w); }} className="p-1 text-faint hover:text-green-600 dark:text-green-400" aria-label={`Complete ${w.wo_number}`}><CheckCircle size={16} /></button>
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
      </>
      )}

      {showForm && (
        <WorkOrderForm
          wo={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && (
        <WorkOrderDetail
          wo={viewing}
          onClose={() => setViewing(null)}
          onChanged={refresh}
          onEdit={() => { setViewing(null); setEditing(viewing); setShowForm(true); }}
          onComplete={() => setCompleting(viewing)}
        />
      )}

      {completing && (
        <CompleteModal
          wo={completing}
          onClose={() => setCompleting(null)}
          onSaved={() => { setCompleting(null); refresh(); }}
        />
      )}
    </div>
  );
}

function useManufacturableProducts() {
  const all = useSelectableProducts();
  return all.filter((p) => !p.is_variant && !(p.variants && p.variants.length > 0));
}

function WorkOrderForm({ wo, onClose, onSaved }: { wo: WorkOrder | null; onClose: () => void; onSaved: () => void }) {
  const products = useManufacturableProducts();
  const [productId, setProductId] = useState(wo ? String(wo.product_id) : "");
  const [quantity, setQuantity] = useState(wo ? String(wo.quantity) : "1");
  const [priority, setPriority] = useState(wo?.priority || "normal");
  const [notes, setNotes] = useState(wo?.notes || "");
  const [mode, setMode] = useState<"bom" | "items">(wo?.bom_id ? "bom" : "items");
  const { data: boms = [] } = useQuery<BOM[]>({
    queryKey: ["boms", "by-product", productId],
    queryFn: async () => (await api.get("/boms", { params: { product_id: productId, limit: PAGE_SIZE } })).data.items,
    enabled: !!productId,
  });
  const [bomId, setBomId] = useState(wo?.bom_id ? String(wo.bom_id) : "");
  const [rows, setRows] = useState(
    wo?.items.map((i) => ({ product_id: String(i.product_id), quantity: String(i.quantity_required) })) || [{ product_id: "", quantity: "1" }]
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
    const qty = parseInt(quantity) || 1;
    setSaving(true);
    try {
      const payload: any = {
        product_id: Number(productId),
        quantity: qty,
        priority,
        notes: notes.trim(),
      };
      if (mode === "bom") {
        if (!bomId) {
          addToast("Select a BOM or switch to manual items", "error");
          setSaving(false);
          return;
        }
        payload.bom_id = Number(bomId);
      } else {
        const items = rows
          .filter((r) => r.product_id)
          .map((r) => ({ product_id: Number(r.product_id), quantity_required: parseInt(r.quantity) || 1 }));
        if (items.length === 0) {
          addToast("Add at least one component", "error");
          setSaving(false);
          return;
        }
        payload.items = items;
      }
      if (wo) {
        await api.put(`/work-orders/${wo.id}`, { quantity: qty, priority, notes: notes.trim() });
        addToast("Work order updated", "success");
      } else {
        const { data } = await api.post("/work-orders", payload);
        addToast(`Work order ${data.wo_number} created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving work order"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={wo ? `Edit ${wo.wo_number}` : "New Work Order"} ariaLabel={wo ? `Edit ${wo.wo_number}` : "New Work Order"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">Production</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Output Product</label>
              <FittedSelect ariaLabel="Output Product" value={productId} onChange={setProductId} disabled={!!wo} options={[{ value: "", label: "Select product..." }, ...products.map((p) => ({ value: String(p.id), label: productLabel(p) }))]} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
              <input type="number" min={1} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Priority</label>
              <FittedSelect ariaLabel="Priority" value={priority} onChange={setPriority} options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }]} />
            </div>
          </div>
        </div>

        {!wo && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-xs font-semibold text-faint uppercase tracking-wider mr-1">Component source</span>
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-primary" checked={mode === "bom"} onChange={() => setMode("bom")} /> Use BOM
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-primary" checked={mode === "items"} onChange={() => setMode("items")} /> Manual components
            </label>
          </div>
        )}

        {mode === "bom" ? (
          <div className="border border-border rounded-xl p-4 bg-app/50">
            <label className="block text-sm font-medium text-ink mb-1">Bill of Materials</label>
            <FittedSelect ariaLabel="Bill of Materials" value={bomId} onChange={setBomId} options={[{ value: "", label: "Select BOM..." }, ...boms.map((b) => ({ value: String(b.id), label: `${b.name} (${b.item_count} components, ${b.total_cost.toFixed(2)})` }))]} />
            {boms.length === 0 && productId && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">No BOMs found for this product. Create one on the BOMs page or use manual components.</p>
            )}
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden bg-app/50">
            <div className="bg-app px-4 py-2.5 flex items-center justify-between border-b border-border">
              <span className="text-sm font-medium text-ink">Components</span>
              <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1" }])} className="btn-secondary text-xs py-1 px-2">
                <Plus size={14} className="inline mr-0.5" />Add Component
              </button>
            </div>
            <div className="divide-y divide-border max-h-[40vh] overflow-auto bg-surface">
              {rows.map((row, idx) => (
                <div key={idx} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
                  <div className="sm:col-span-8">
                    <label className="block text-xs font-medium text-muted mb-1">Product</label>
                    <FittedSelect ariaLabel="Component Product" value={row.product_id} onChange={(v) => setRow(idx, "product_id", v)} options={[{ value: "", label: "Select..." }, ...products.filter((p) => p.id !== Number(productId)).map((p) => ({ value: String(p.id), label: productLabel(p) }))]} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-muted mb-1">Qty</label>
                    <input type="number" min={1} className="input" value={row.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400 transition-colors" aria-label="Remove component">
                      <XCircle size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 sm:flex-none">Cancel</button>
          <button type="submit" disabled={saving || !productId} className="btn-primary flex-1 sm:flex-none">{saving ? "Saving..." : "Save Work Order"}</button>
        </div>
      </form>
    </SlideOver>
  );
}

function WorkOrderDetail({ wo, onClose, onChanged, onEdit, onComplete }: {
  wo: WorkOrder;
  onClose: () => void;
  onChanged: () => void;
  onEdit?: () => void;
  onComplete?: () => void;
}) {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { can } = useAuth();
  const { addToast } = useToast();
  const [acting, setActing] = useState(false);

  const { data: fresh } = useQuery({
    queryKey: ["work-order", wo.id],
    queryFn: async () => (await api.get(`/work-orders/${wo.id}`)).data as WorkOrder,
    initialData: wo,
  });
  const current = fresh ?? wo;

  const { data: genealogy } = useQuery({
    queryKey: ["work-order-genealogy", wo.id],
    queryFn: async () => {
      const { data } = await api.get(`/work-orders/${wo.id}/genealogy`);
      return data as WorkOrderGenealogy;
    },
  });

  const run = async (fn: () => Promise<void>, msg: string) => {
    if (acting) return;
    setActing(true);
    try {
      await fn();
      addToast(msg, "success");
      onChanged();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Action failed"), "error");
    }
    setActing(false);
  };

  const printPdf = async () => {
    try {
      const { data } = await api.get(`/work-orders/${current.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  const headerActions = current.status === "planned" && can("work_orders.update") && onEdit ? (
    <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label={`Edit ${current.wo_number}`}>
      <Pencil size={14} />Edit Work Order
    </button>
  ) : undefined;

  return (
    <SlideOver open onClose={onClose} title={current.wo_number} wide ariaLabel={`Work order ${current.wo_number} details`} actions={headerActions}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <span className={`badge ${statusBadge(current.status)}`}>{current.status.replace("_", " ")}</span>
          <span className={`badge ${current.priority === "high" ? "badge-danger" : current.priority === "low" ? "badge-success" : "badge-info"}`}>{current.priority}</span>
        </div>

        <div className="border border-border rounded-xl px-5 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Product</p>
              <p className="font-medium text-ink break-words">{current.product_name}</p>
            </div>
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Quantity</p>
              <p className="font-semibold text-ink tabular-nums">{current.quantity}</p>
            </div>
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Issued / Required</p>
              <p className="font-semibold tabular-nums text-ink">
                {current.total_issued}<span className="text-faint text-sm font-medium"> / {current.total_required}</span>
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">BOM</p>
              <p className="font-medium text-ink break-words">{current.bom_name || "Manual components"}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted">Created By</p>
            <p className="font-medium">{current.username}</p>
          </div>
          <div>
            <p className="text-muted">Started</p>
            <p className="font-medium">{current.started_at ? formatDate(current.started_at) : "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-muted">Created</p>
            <p className="font-medium">{formatDate(current.created_at)}</p>
          </div>
          {current.notes && (
            <div className="col-span-2">
              <p className="text-muted">Notes</p>
              <p className="font-medium">{current.notes}</p>
            </div>
          )}
        </div>

        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-app px-4 py-2.5 text-sm font-semibold text-ink border-b border-border">Components</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-2 font-medium text-muted">Component</th>
                  <th className="px-4 py-2 font-medium text-muted">Required</th>
                  <th className="px-4 py-2 font-medium text-muted">Issued</th>
                  <th className="px-4 py-2 font-medium text-muted">Remaining</th>
                  <th className="px-4 py-2 font-medium text-muted">Unit Cost</th>
                  <th className="px-4 py-2 font-medium text-muted text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {current.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 font-medium">{item.product_name}</td>
                    <td className="px-4 py-2">{item.quantity_required}</td>
                    <td className="px-4 py-2">{item.quantity_issued}</td>
                    <td className="px-4 py-2">{Math.max(0, item.quantity_required - item.quantity_issued)}</td>
                    <td className="px-4 py-2">{formatCurrency(item.unit_cost, currencySymbol)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(item.unit_cost * item.quantity_required, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <GenealogySection genealogy={genealogy} woNumber={current.wo_number} />
        <CostSection woId={current.id} />
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {current.status === "planned" && can("work_orders.release") && (
            <button onClick={() => run(() => api.post(`/work-orders/${current.id}/release`), `${current.wo_number} released`)} disabled={acting} className="btn-secondary flex-1 sm:flex-none">
              <Rocket size={16} />Release
            </button>
          )}
          {current.status === "released" && can("work_orders.release") && (
            <button onClick={() => run(() => api.post(`/work-orders/${current.id}/start`), `${current.wo_number} started`)} disabled={acting} className="btn-secondary flex-1 sm:flex-none">
              <Play size={16} />Start
            </button>
          )}
          {(current.status === "released" || current.status === "in_progress") && can("work_orders.complete") && onComplete && (
            <button onClick={onComplete} className="btn-primary flex-1 sm:flex-none">
              <CheckCircle size={16} />Complete WO
            </button>
          )}
          {(current.status === "planned" || current.status === "released" || current.status === "in_progress") && can("work_orders.update") && (
            <button onClick={() => run(() => api.post(`/work-orders/${current.id}/cancel`), `${current.wo_number} cancelled`)} disabled={acting} className="btn-danger flex-1 sm:flex-none">
              <XCircle size={16} />Cancel
            </button>
          )}
          <button onClick={printPdf} className="btn-secondary flex-1 sm:flex-none">
            <Printer size={16} />Print PDF
          </button>
        </div>
      </div>
    </SlideOver>
  );
}

function CostSection({ woId }: { woId: number }) {
  const { data: cost, isLoading } = useQuery({
    queryKey: ["work-order-cost", woId],
    queryFn: async () => {
      const { data } = await api.get(`/costing/work-orders/${woId}`);
      return data as WorkOrderCost;
    },
  });
  if (isLoading) {
    return (
      <div className="space-y-3 border-t border-border pt-3" aria-busy="true" aria-label="Loading manufacturing cost" role="status">
        <Skeleton variant="text" className="h-4 w-40" />
        <div className="border border-border rounded-xl px-5 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="min-w-0 space-y-1">
                <Skeleton variant="text" className="h-3 w-20" />
                <Skeleton variant="text" className="h-4 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!cost) return null;
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink">Manufacturing Cost</h4>
      <div className="border border-border rounded-xl px-5 py-4 sm:px-6 sm:py-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 text-sm">
          <div className="min-w-0">
            <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Material Cost</p>
            <p className="font-semibold text-ink tabular-nums">{cost.material_cost.toFixed(2)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Std / Unit</p>
            <p className="font-semibold text-ink tabular-nums">{cost.standard_unit_cost.toFixed(2)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Actual / Unit</p>
            <p className="font-semibold text-ink tabular-nums">{cost.actual_unit_cost.toFixed(2)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Variance</p>
            <p className={`font-semibold text-ink tabular-nums ${cost.variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{cost.variance >= 0 ? "+" : ""}{cost.variance.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenealogySection({ genealogy, woNumber }: { genealogy: WorkOrderGenealogy | undefined; woNumber: string }) {
  if (!genealogy || (genealogy.component_lots.length === 0 && genealogy.fg_lots.length === 0)) {
    return (
      <div className="text-sm text-faint border border-border rounded-xl p-4 bg-subtle/40">
        Lot genealogy unavailable — complete this work order with an FG lot number to record traceability links.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-ink">Lot Genealogy</h4>
      {genealogy.fg_lots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {genealogy.fg_lots.map((l) => (
            <span key={l.lot_id} className="badge badge-success border border-green-200 dark:border-green-500/30">
              FG: {l.lot_number} ({l.product_name} × {l.quantity})
            </span>
          ))}
        </div>
      )}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
<thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-2 font-medium text-muted">Consumed Lot</th>
                  <th className="px-4 py-2 font-medium text-muted">Product</th>
                  <th className="px-4 py-2 font-medium text-muted">Qty</th>
                  <th className="px-4 py-2 font-medium text-muted">Produced Lot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {genealogy.links.map((link, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium">{link.parent_lot_number}</td>
                    <td className="px-4 py-2 text-muted">{genealogy.component_lots.find((c) => c.lot_id === link.parent_lot_id)?.product_name || "—"}</td>
                    <td className="px-4 py-2">{link.quantity}</td>
                    <td className="px-4 py-2">{link.child_lot_number}</td>
                  </tr>
                ))}
              </tbody>
          </table>
        </div>
      </div>
      {genealogy.links.length === 0 && (
        <p className="text-sm text-muted">Completed with FG lot {genealogy.fg_lots[0]?.lot_number} but no component lots were consumed (manual issue without lot assignment).</p>
      )}
      <p className="text-xs text-faint">Shows which source lots were consumed by {woNumber} to produce the finished-good lot.</p>
    </div>
  );
}

function CompleteModal({ wo, onClose, onSaved }: { wo: WorkOrder; onClose: () => void; onSaved: () => void }) {
  const [receivedQty, setReceivedQty] = useState(String(wo.quantity));
  const [receiveLocationId, setReceiveLocationId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [serials, setSerials] = useState("");
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["locations", "lookup"],
    queryFn: async () => (await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } })).data.items,
  });
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveLocationId) {
      addToast("Select a receive location", "error");
      return;
    }
    const serialList = serials.split("\n").map((s) => s.trim()).filter(Boolean);
    if (wo.is_serialized) {
      const qty = parseInt(receivedQty) || wo.quantity;
      if (serialList.length !== qty) {
        addToast(`Enter exactly ${qty} serial number(s), one per line`, "error");
        return;
      }
    }
    setSaving(true);
    try {
      await api.post(`/work-orders/${wo.id}/complete`, {
        received_qty: parseInt(receivedQty) || wo.quantity,
        receive_location_id: Number(receiveLocationId),
        lot_number: lotNumber.trim() || undefined,
        serial_numbers: serialList,
      });
      addToast(`${wo.wo_number} completed`, "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error completing work order"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Complete ${wo.wo_number}`} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Received Qty</label>
            <input type="number" min={1} className="input" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} disabled={wo.is_serialized} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Receive Location</label>
            <FittedSelect ariaLabel="Receive Location" value={receiveLocationId} onChange={setReceiveLocationId} options={[{ value: "", label: "Select location..." }, ...locations.filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path)).map((l) => ({ value: String(l.id), label: l.path }))]} />
          </div>
        </div>
        {wo.is_serialized ? (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Serial Numbers ({wo.quantity} required, one per line)</label>
            <textarea className="input font-mono text-xs" rows={Math.max(3, wo.quantity)} value={serials} onChange={(e) => setSerials(e.target.value)} placeholder={"SN-0001\nSN-0002"} />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">FG Lot Number (optional)</label>
            <input className="input" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="e.g. FG-0001" />
          </div>
        )}
        <p className="text-xs text-muted">
          {wo.is_serialized
            ? "Each serial number registers one finished unit, enabling serial-level traceability back to consumed lots."
            : "Receiving creates a finished-good stock entry; a supplied lot number enables lot traceability."}
        </p>
        <div className="flex flex-wrap justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 sm:flex-none">Cancel</button>
          <button type="submit" disabled={saving || !receiveLocationId} className="btn-primary flex-1 sm:flex-none">{saving ? "Completing..." : "Complete WO"}</button>
        </div>
      </form>
    </Modal>
  );
}