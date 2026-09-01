import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Pencil, Trash2, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Eye, Search, Download, ArrowRightLeft, PackagePlus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, StockMovement } from "../types";
import StockMovementDetail from "../components/StockMovementDetail";
import StockMovementForm from "../components/StockMovementForm";
import TransferModal from "../components/TransferModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";
import { MOVEMENT_TYPES, movementBadgeClass, movementLabel } from "../utils/movementTypes";

export default function StockMovements() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [movementType, setMovementType] = useState(() => new URLSearchParams(window.location.search).get("movement_type") ?? "all");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [editing, setEditing] = useState<StockMovement | null>(null);
  const [viewing, setViewing] = useState<StockMovement | null>(null);
  const [deleting, setDeleting] = useState<StockMovement | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["stock-movements", debouncedSearch, movementType, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (movementType !== "all") params.movement_type = movementType;
      const { data } = await api.get("/stock-movements", { params });
      return data as PaginatedResponse<StockMovement>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/stock-movements/${id}`),
    onSuccess: () => {
      addToast("Stock movement deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete movement"), "error");
    },
  });

  const movements = data?.items || [];
  const isTransfer = (m: StockMovement) => m.movement_type === "transfer_out" || m.movement_type === "transfer_in";
  const routeLabel = (m: StockMovement) => {
    const from = m.from_location_name;
    const to = m.to_location_name;
    if (from && to) return `${from} → ${to}`;
    return from || to || "";
  };

  const handleExport = () => {
    exportCSV(
      ["Date", "Product", "Type", "Route", "Qty Change", "Reference", "User", "Notes"],
      movements.map((m) => [formatDate(m.created_at), m.product_name, m.movement_type, routeLabel(m), m.quantity_change, m.reference, m.username, m.notes]),
      "stock-movements"
    );
    addToast("Movements exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">Stock Movements</h1>
          <p className="text-sm text-muted mt-1">Every change to inventory — moves, adjustments, and transfers in one timeline.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary inline-flex items-center gap-1" aria-label="Export movements to CSV">
            <Download size={16} /> Download CSV
          </button>
          {can("stock.record") && (
            <>
              <button onClick={() => setShowTransfer(true)} className="btn-secondary inline-flex items-center gap-1">
                <ArrowRightLeft size={16} /> Transfer
              </button>
              <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-1">
                <PackagePlus size={16} /> Record Movement
              </button>
            </>
          )}
        </div>
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load movements")}</div>}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by product, reference, or notes..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search stock movements" />
        </div>
        <select
          className="select w-44"
          value={movementType}
          onChange={(e) => { setMovementType(e.target.value); setPage(1); }}
          aria-label="Filter by movement type"
        >
          <option value="all">All types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>{movementLabel(t)}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Stock movements table">
          <thead>
            <tr className="bg-subtle text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">Date</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Type</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Route</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Qty Change</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Reference</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">User</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Notes</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={9} />
            ) : movements.length === 0 ? (
              <EmptyState title="No movements recorded" message="Record a stock movement to start tracking inventory changes." actionLabel="Record Movement" onAction={() => setShowForm(true)} />
            ) : movements.map((m) => (
              <tr key={m.id} className="hover:bg-app cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) setViewing(m); }}>
                <td className="px-4 py-3 text-muted">
                  {formatDate(m.created_at)}
                </td>
                <td className="px-4 py-3 font-medium">{m.product_name}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${movementBadgeClass(m.movement_type)}`}>
                    {movementLabel(m.movement_type)}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">
                  {isTransfer(m) ? (
                    <div>
                      <div className="flex items-center gap-1">
                        <span>{m.from_location_name || "—"}</span>
                        <ArrowLeftRight size={12} className="text-faint" />
                        <span>{m.to_location_name || "—"}</span>
                      </div>
                      {m.transfer_id != null && (
                        <div className="text-xs text-faint">paired #{m.transfer_id}</div>
                      )}
                    </div>
                  ) : m.from_location_name || m.to_location_name ? (
                    <div className="flex items-center gap-1">
                      {m.from_location_name && <span>{m.from_location_name}</span>}
                      {m.from_location_name && m.to_location_name && <ArrowLeftRight size={12} className="text-faint" />}
                      {m.to_location_name && <span>{m.to_location_name}</span>}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {m.quantity_change > 0 ? (
                      <ArrowUpRight size={16} className="text-green-500" />
                    ) : (
                      <ArrowDownRight size={16} className="text-red-500" />
                    )}
                    <span className={m.quantity_change > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                      {m.quantity_change > 0 ? "+" : ""}
                      {m.quantity_change}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{m.reference}</td>
                <td className="px-4 py-3 text-muted">{m.username}</td>
                <td className="px-4 py-3 text-muted max-w-50 truncate">{m.notes}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {can("stock.update") && !isTransfer(m) && m.movement_type !== "ship" && (
                      <button onClick={() => { setEditing(m); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit movement ${m.id}`}>
                        <Pencil size={16} />
                      </button>
                    )}
                    <button onClick={() => setViewing(m)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View movement ${m.id}`}><Eye size={16} /></button>
                    {can("stock.delete") && m.movement_type !== "ship" && (
                      <button onClick={() => setDeleting(m)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete movement ${m.id}`}>
                        <Trash2 size={16} />
                      </button>
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
        <StockMovementForm
          movement={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["stock-movements"] }); }}
        />
      )}

      {showTransfer && (
        <TransferModal
          onClose={() => setShowTransfer(false)}
          onSaved={() => setShowTransfer(false)}
        />
      )}

      {viewing && <StockMovementDetail movement={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Stock Movement"
        message={deleting && isTransfer(deleting)
          ? `This movement is part of a matched transfer. Deleting it will revert the entire transfer (both the outbound and inbound legs) and cannot be undone.`
          : `Are you sure you want to delete this movement? This will revert the quantity change on the product and cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
