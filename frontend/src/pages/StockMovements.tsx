import { useState } from "react";
import { Pencil, Trash2, ArrowUpRight, ArrowDownRight, Eye } from "lucide-react";
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

const PAGE_SIZE = 25;

export default function StockMovements() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
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
    queryKey: ["stock-movements", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
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
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Cannot delete movement", "error");
    },
  });

  const movements = data?.items || [];

  const handleExport = () => {
    exportCSV(
      ["Date", "Product", "Type", "Qty Change", "Reference", "User", "Notes"],
      movements.map((m) => [new Date(m.created_at).toLocaleDateString(), m.product_name, m.movement_type, m.quantity_change, m.reference, m.username, m.notes]),
      "stock-movements"
    );
    addToast("Movements exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Stock Movements</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export movements to CSV">
            Export
          </button>
          {can("stock.record") && (
            <>
              <button onClick={() => setShowTransfer(true)} className="btn-secondary">
                Transfer
              </button>
              <button onClick={() => setShowForm(true)} className="btn-primary">
                Record Movement
              </button>
            </>
          )}
        </div>
      </div>

      {isError && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">Failed to load movements: {(error as any)?.message}</div>}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by product, reference, or notes..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search stock movements" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Stock movements table">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 font-medium text-gray-600">Product</th>
              <th className="px-4 py-3 font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 font-medium text-gray-600">Qty Change</th>
              <th className="px-4 py-3 font-medium text-gray-600">Reference</th>
              <th className="px-4 py-3 font-medium text-gray-600">User</th>
              <th className="px-4 py-3 font-medium text-gray-600">Notes</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <Skeleton rows={5} cols={8} />
            ) : movements.length === 0 ? (
              <EmptyState title="No movements recorded" message="Record a stock movement to start tracking inventory changes." actionLabel="Record Movement" onAction={() => setShowForm(true)} />
            ) : movements.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 font-medium">{m.product_name}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${["in", "receive", "transfer_in", "sale_return", "count"].includes(m.movement_type) ? "badge-success" : ["out", "sale", "transfer_out", "issue", "backflush", "return"].includes(m.movement_type) ? "badge-danger" : "badge-info"}`}>
                    {m.movement_type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {m.quantity_change > 0 ? (
                      <ArrowUpRight size={16} className="text-green-500" />
                    ) : (
                      <ArrowDownRight size={16} className="text-red-500" />
                    )}
                    <span className={m.quantity_change > 0 ? "text-green-600" : "text-red-600"}>
                      {m.quantity_change > 0 ? "+" : ""}
                      {m.quantity_change}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500">{m.reference}</td>
                <td className="px-4 py-3 text-gray-500">{m.username}</td>
                <td className="px-4 py-3 text-gray-500 max-w-50 truncate">{m.notes}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {can("stock.update") && (
                      <button onClick={() => { setEditing(m); setShowForm(true); }} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Edit movement ${m.id}`}>
                        <Pencil size={16} />
                      </button>
                    )}
                    <button onClick={() => setViewing(m)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View movement ${m.id}`}><Eye size={16} /></button>
                    {can("stock.delete") && (
                      <button onClick={() => setDeleting(m)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Delete movement ${m.id}`}>
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
        message={`Are you sure you want to delete this movement? This will revert the quantity change on the product and cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
