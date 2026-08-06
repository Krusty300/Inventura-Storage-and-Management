import { useState } from "react";
import { Eye, RotateCcw, FileText } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Sale } from "../types";
import SaleForm from "../components/SaleForm";
import SaleDetail from "../components/SaleDetail";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig } from "../components/EntityBulkEditModal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useSettings } from "../hooks/useSettings";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

const PAGE_SIZE = 25;

export default function Sales() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["sales", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/sales", { params });
      return data as PaginatedResponse<Sale>;
    },
  });

  const refundMutation = useMutation({
    mutationFn: (id: number) => api.put(`/sales/${id}/refund`),
    onSuccess: () => {
      addToast("Sale refunded, stock restored", "success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Refund failed", "error"),
  });

  const sales = data?.items || [];
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(sales);

  const bulkFields: BulkFieldConfig[] = [
    { name: "notes", label: "Notes", type: "text" },
  ];

  const handleExport = () => {
    exportCSV(
      ["Invoice #", "Customer", "Date", "Status", "Payment", "Total"],
      sales.map((s) => [s.invoice_number, s.customer_name, new Date(s.created_at).toLocaleDateString(), s.status, s.payment_method, s.total_amount]),
      "sales"
    );
    addToast("Sales exported to CSV", "success");
  };

  const printPdf = (id: number) => {
    api.get(`/sales/${id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Sales</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export sales to CSV">Export</button>
          <button onClick={() => setShowForm(true)} className="btn-primary">New Sale</button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by invoice number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search sales" />
        </div>
      </div>

      <BulkActionBar count={selectedIds.size} canEdit={can("sales.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Sales table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3">
                <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all sales" />
              </th>
              <th className="px-4 py-3 font-medium text-muted">Invoice #</th>
              <th className="px-4 py-3 font-medium text-muted">Customer</th>
              <th className="px-4 py-3 font-medium text-muted">Date</th>
              <th className="px-4 py-3 font-medium text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-muted">Payment</th>
              <th className="px-4 py-3 font-medium text-muted">Total</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={8} />
            ) : sales.length === 0 ? (
              <EmptyState title="No sales yet" message="Record your first sale to start tracking revenue." actionLabel="New Sale" onAction={() => setShowForm(true)} />
            ) : sales.map((s) => (
              <tr key={s.id} className="hover:bg-app">
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} aria-label={`Select invoice ${s.invoice_number}`} />
                </td>
                <td className="px-4 py-3 font-medium">{s.invoice_number}</td>
                <td className="px-4 py-3 text-muted">{s.customer_name}</td>
                <td className="px-4 py-3 text-muted">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${s.status === "completed" ? "badge-success" : "badge-danger"}`}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-muted capitalize">{s.payment_method}</td>
                <td className="px-4 py-3">{formatCurrency(s.total_amount, currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(s)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View invoice ${s.invoice_number}`}>
                      <Eye size={16} />
                    </button>
                    <button onClick={() => printPdf(s.id)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Download invoice ${s.invoice_number}`}>
                      <FileText size={16} />
                    </button>
                    {s.status === "completed" && can("sales.refund") && (
                      <button onClick={() => setRefunding(s)} className="p-1 text-faint hover:text-orange-600 dark:text-orange-400" aria-label={`Refund ${s.invoice_number}`}>
                        <RotateCcw size={16} />
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
        <SaleForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["sales"] }); }}
        />
      )}

      {viewing && <SaleDetail sale={viewing} onClose={() => setViewing(null)} />}

      {showBulkEdit && (
        <EntityBulkEditModal
          ids={[...selectedIds]}
          entityLabel="Sale"
          endpoint="/sales/bulk-edit"
          fields={bulkFields}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ["sales"] });
            addToast("Sales updated", "success");
          }}
        />
      )}

      <ConfirmDialog
        open={!!refunding}
        title="Refund Sale"
        message={`Refund invoice "${refunding?.invoice_number}" (${formatCurrency(refunding?.total_amount ?? 0, currencySymbol)}) and restore stock?`}
        confirmLabel="Refund"
        confirmClass="btn-danger"
        onConfirm={() => { refundMutation.mutate(refunding!.id); setRefunding(null); }}
        onCancel={() => setRefunding(null)}
      />
    </div>
  );
}
