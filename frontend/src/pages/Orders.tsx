import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useState } from "react";
import { Pencil, Eye, Trash2, Printer, ShoppingCart, Fingerprint } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Order, PaginatedResponse } from "../types";
import OrderForm from "../components/OrderForm";
import OrderDetail from "../components/OrderDetail";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig } from "../components/EntityBulkEditModal";
import PageHeader from "../components/PageHeader";
import FilterBar from "../components/FilterBar";
import Pagination from "../components/Pagination";
import Table from "../components/Table";
import EmptyState from "../components/EmptyState";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useSettings } from "../hooks/useSettings";
import { useExportCsv } from "../hooks/useExportCsv";
import { usePageQuery } from "../hooks/usePageQuery";
import { formatCurrency } from "../utils/currency";
import { statusBadge } from "../utils/statusBadges";
import { overdueStatus } from "../utils/date";
import { errorMessage } from "../utils/errors";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

export default function Orders() {
  const formatDateTime = useDateTimeFormat();
  const q = usePageQuery<{ status: string }>({ status: "" });
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
      const noun = orders.length === 1 ? "PO" : "POs";
      addToast(`Reorder ${noun} ${numbers} created for ${totalProducts} product(s)`, "success");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Auto-reorder failed"), "error");
    },
  });

  const openEdit = (order: Order) => {
    setEditing(order);
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orders", ...q.deps],
    queryFn: async () => {
      const { data } = await api.get("/orders", { params: q.params });
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
    exportCsv("/reports/export/orders", "orders_report.csv", "Orders", q.debouncedSearch ? { search: q.debouncedSearch } : undefined);
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

  const arrivalBadge = (o: Order) => {
    if (!o.expected_arrival) return <span className="text-muted">—</span>;
    const text = formatDateTime(o.expected_arrival);
    const isOpen = ["pending", "submitted", "approved", "acknowledged", "in_transit"].includes(o.status);
    if (!isOpen) return <span className="text-muted text-xs">{text}</span>;
    const status = overdueStatus(o.expected_arrival);
    if (status === "overdue") return <span className="badge badge-danger">Overdue {text}</span>;
    if (status === "due") return <span className="badge badge-warning">Due {text}</span>;
    return <span className="text-muted text-xs">{text}</span>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingCart}
        title="Orders / Purchase Orders"
        subtitle="Place and receive orders with your suppliers."
        actions={
          <>
            <button onClick={handleExport} className="btn-secondary" aria-label="Export orders to CSV">
              Export
            </button>
            <button onClick={() => setConfirmAutoReorder(true)} className="btn-secondary" aria-label="Auto-reorder low stock">
              Reorder
            </button>
            <button onClick={() => setShowForm(true)} className="btn-primary">
              New Order
            </button>
          </>
        }
      />

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load orders")}</div>}

      <FilterBar
        columns={2}
        values={{ search: q.search, ...q.filters }}
        setFilter={q.setFilter}
        items={[
          { type: "search", ariaLabel: "Search orders", placeholder: "Search by order number...", className: "sm:col-span-2 lg:col-span-1" },
          {
            type: "select",
            key: "status",
            ariaLabel: "Filter by status",
            placeholder: "All statuses",
            maxWidth: 150,
            options: [
              { value: "pending", label: "Pending" },
              { value: "submitted", label: "Submitted" },
              { value: "approved", label: "Approved" },
              { value: "acknowledged", label: "Acknowledged" },
              { value: "in_transit", label: "In Transit" },
              { value: "received", label: "Received" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
        ]}
      />

      <BulkActionBar count={selectedIds.size} canEdit={can("orders.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <Table
          columns={[
            { key: 'select', header: <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all orders" />, className: 'px-4 py-3' },
            { key: 'order', header: 'Order #', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'supplier', header: 'Supplier', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'placed', header: 'Placed', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'expectedArrival', header: 'Expected Arrival', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'received', header: 'Received', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'status', header: 'Status', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'total', header: 'Total', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'actions', header: 'Actions', className: 'px-4 py-3 font-medium text-muted' },
          ]}
          role="grid"
          aria-label="Orders table"
          loading={isLoading}
          skeletonRows={5}
          noData={orders.length === 0}
          empty={<EmptyState title={q.search || q.filters.status ? "No matching orders" : "No orders"} message={q.search || q.filters.status ? "Nothing matched your search or filters. Try adjusting them." : "Create a purchase order to start tracking deliveries."} actionLabel={q.search || q.filters.status ? undefined : "New Order"} onAction={q.search || q.filters.status ? undefined : () => setShowForm(true)} />}
        >
          {orders.map((o) => (
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
                <td className="px-4 py-3 text-muted whitespace-nowrap">
                  {formatDateTime(o.created_at)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{arrivalBadge(o)}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap">
                  {o.received_at ? formatDateTime(o.received_at) : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusBadge(o.status)}`}>{o.status}</span>
                </td>
                <td className="px-4 py-3">{formatCurrency(o.total_amount, currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {o.status === "pending" && (
                      <button onClick={() => openEdit(o)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit order ${o.order_number}`}>
                        <Pencil size={16} />
                      </button>
                    )}
                    <button onClick={() => setViewing(o)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View order ${o.order_number}`}>
                      <Eye size={16} />
                    </button>
                    <button onClick={() => printPdf(o)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Print order ${o.order_number}`}>
                      <Printer size={16} />
                    </button>
                    {!["received", "approved", "acknowledged", "in_transit"].includes(o.status) && (
                      <button onClick={() => setDeleting(o)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete order ${o.order_number}`}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </Table>
        </div>
      </div>

      <Pagination page={q.page} totalPages={data?.pages || 1} onPageChange={q.setPage} pageSize={q.pageSize} onPageSizeChange={(n) => { q.setPageSize(n); q.setPage(1); }} />

      {showForm && (
        <OrderForm
          order={undefined}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["orders"] }); }}
        />
      )}

      {editing && (
        <OrderForm
          order={editing}
          onClose={() => { setEditing(null); }}
          onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ["orders"] }); }}
        />
      )}

      {viewing && (
        <OrderDetail
          order={viewing}
          onClose={() => setViewing(null)}
          onUpdated={() => { setViewing(null); queryClient.invalidateQueries({ queryKey: ["orders"] }); }}
          onEdit={() => { setViewing(null); openEdit(viewing); }}
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
        message="Generate purchase order(s) for all products the forecast says need replenishing?"
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
