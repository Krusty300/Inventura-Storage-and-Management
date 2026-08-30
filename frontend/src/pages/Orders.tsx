import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Pencil, Eye, Trash2, Printer, Search, Fingerprint } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Order, PaginatedResponse } from "../types";
import OrderForm from "../components/OrderForm";
import OrderDetail from "../components/OrderDetail";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig } from "../components/EntityBulkEditModal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useSettings } from "../hooks/useSettings";
import { useExportCsv } from "../hooks/useExportCsv";
import { formatCurrency } from "../utils/currency";
import { statusBadge } from "../utils/statusBadges";
import { errorMessage } from "../utils/errors";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

import { usePageSize } from "../hooks/usePageSize";

export default function Orders() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [editing, setEditing] = useState<Order | null>(null);
  const [viewing, setViewing] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState<Order | null>(null);
  const [confirmAutoReorder, setConfirmAutoReorder] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const debouncedSearch = useDebounce(search, 300);
  const { exportCsv } = useExportCsv();

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/orders/${id}`),
    onSuccess: () => {
      addToast("Order deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete order"), "error");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: () => api.post("/orders/auto-reorder"),
    onSuccess: (res) => {
      const orders = res.data as { order_number: string; items: unknown[] }[];
      const totalProducts = orders.reduce((n, o) => n + o.items.length, 0);
      const numbers = orders.map((o) => `#${o.order_number}`).join(", ");
      addToast(`Reorder PO ${numbers} created for ${totalProducts} product(s)`, "success");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Auto-reorder failed"), "error");
    },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orders", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/orders", { params });
      return data as PaginatedResponse<Order>;
    },
  });

  const orders = data?.items || [];
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(orders);

  const bulkFields: BulkFieldConfig[] = [
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [{ value: "cancelled", label: "Cancelled" }],
    },
    { name: "notes", label: "Notes", type: "text" },
  ];

  const handleExport = () => {
    exportCsv("/reports/export/orders", "orders_report.csv", "Orders", debouncedSearch ? { search: debouncedSearch } : undefined);
  };

  const printPdf = async (o: Order) => {
    try {
      const { data } = await api.get(`/orders/${o.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Orders / Purchase Orders</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export orders to CSV">
            Export
          </button>
          <button onClick={() => setConfirmAutoReorder(true)} className="btn-secondary" aria-label="Auto-reorder low stock">
            Reorder
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            New Order
          </button>
        </div>
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load orders")}</div>}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by order number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search orders" />
        </div>
      </div>

      <BulkActionBar count={selectedIds.size} canEdit={can("orders.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Orders table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3">
                <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all orders" />
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Order #</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Supplier</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Date</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Total</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : orders.length === 0 ? (
              <EmptyState title="No orders" message="Create a purchase order to start tracking deliveries." actionLabel="New Order" onAction={() => setShowForm(true)} />
            ) : orders.map((o) => (
              <tr key={o.id} className="hover:bg-app cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) setViewing(o); }}>
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} aria-label={`Select order ${o.order_number}`} />
                </td>
                <td className="px-4 py-3 font-medium">
                  {o.order_number}
                  {o.items?.some((i) => i.is_serialized) && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/30">
                      <Fingerprint size={10} />
                      S
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{o.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-muted">
                  {formatDate(o.created_at)}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusBadge(o.status)}`}>{o.status}</span>
                </td>
                <td className="px-4 py-3">{formatCurrency(o.total_amount, currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {o.status === "pending" && (
                      <button onClick={() => setEditing(o)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit order ${o.order_number}`}>
                        <Pencil size={16} />
                      </button>
                    )}
                    <button onClick={() => setViewing(o)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View order ${o.order_number}`}>
                      <Eye size={16} />
                    </button>
                    <button onClick={() => printPdf(o)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print order ${o.order_number}`}>
                      <Printer size={16} />
                    </button>
                    {o.status !== "received" && (
                      <button onClick={() => setDeleting(o)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete order ${o.order_number}`}>
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

      {(showForm || editing) && (
        <OrderForm
          order={editing || undefined}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["orders"] }); }}
        />
      )}

      {viewing && (
        <OrderDetail
          order={viewing}
          onClose={() => setViewing(null)}
          onUpdated={() => { setViewing(null); queryClient.invalidateQueries({ queryKey: ["orders"] }); }}
        />
      )}

      {showBulkEdit && (
        <EntityBulkEditModal
          ids={[...selectedIds]}
          entityLabel="Order"
          endpoint="/orders/bulk-edit"
          fields={bulkFields}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ["orders"] });
            addToast("Orders updated", "success");
          }}
        />
      )}

      <ConfirmDialog
        open={confirmAutoReorder}
        title="Auto-Reorder Stock"
        message="Generate a purchase order for all products that are at or below their reorder level?"
        confirmLabel="Generate PO"
        confirmClass="btn-primary"
        onConfirm={() => { setConfirmAutoReorder(false); reorderMutation.mutate(); }}
        onCancel={() => setConfirmAutoReorder(false)}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete Order"
        message={`Are you sure you want to delete order "${deleting?.order_number}"? This action cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
