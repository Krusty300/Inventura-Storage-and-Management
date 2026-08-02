import { useState } from "react";
import { Pencil, Eye, Trash2, Printer } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Order, PaginatedResponse } from "../types";
import OrderForm from "../components/OrderForm";
import OrderDetail from "../components/OrderDetail";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useSettings } from "../hooks/useSettings";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { useToast } from "../context/ToastContext";

const statusColors: Record<string, string> = {
  pending: "badge-warning",
  received: "badge-success",
  cancelled: "badge-danger",
};

const PAGE_SIZE = 25;

export default function Orders() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [viewing, setViewing] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState<Order | null>(null);
  const [confirmAutoReorder, setConfirmAutoReorder] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const debouncedSearch = useDebounce(search, 300);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/orders/${id}`),
    onSuccess: () => {
      addToast("Order deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Cannot delete order", "error");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: () => api.post("/orders/auto-reorder"),
    onSuccess: (res) => {
      addToast(`Reorder PO #${res.data.order_number} created for ${res.data.items.length} product(s)`, "success");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Auto-reorder failed", "error");
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

  const handleExport = () => {
    exportCSV(
      ["Order #", "Supplier", "Date", "Status", "Total"],
      orders.map((o) => [o.order_number, o.supplier_name || "", new Date(o.created_at).toLocaleDateString(), o.status, o.total_amount]),
      "orders"
    );
    addToast("Orders exported to CSV", "success");
  };

  const printPdf = async (o: Order) => {
    try {
      const { data } = await api.get(`/orders/${o.id}/pdf`, { responseType: "blob" });
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
        <h1 className="text-2xl font-bold text-gray-900">Orders / Purchase Orders</h1>
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

      {isError && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">Failed to load orders: {(error as any)?.message}</div>}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by order number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search orders" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Orders table">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Order #</th>
              <th className="px-4 py-3 font-medium text-gray-600">Supplier</th>
              <th className="px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 font-medium text-gray-600">Total</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <Skeleton rows={5} cols={6} />
            ) : orders.length === 0 ? (
              <EmptyState title="No orders" message="Create a purchase order to start tracking deliveries." actionLabel="New Order" onAction={() => setShowForm(true)} />
            ) : orders.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{o.order_number}</td>
                <td className="px-4 py-3 text-gray-500">{o.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(o.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <span className={statusColors[o.status] || "badge-info"}>{o.status}</span>
                </td>
                <td className="px-4 py-3">{formatCurrency(o.total_amount, currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {o.status === "pending" && (
                      <button onClick={() => setEditing(o)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Edit order ${o.order_number}`}>
                        <Pencil size={16} />
                      </button>
                    )}
                    <button onClick={() => setViewing(o)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View order ${o.order_number}`}>
                      <Eye size={16} />
                    </button>
                    <button onClick={() => printPdf(o)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Print order ${o.order_number}`}>
                      <Printer size={16} />
                    </button>
                    <button onClick={() => setDeleting(o)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Delete order ${o.order_number}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
