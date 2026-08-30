import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Eye, RotateCcw, FileText, XCircle, Trash2, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Sale, SalesChannel } from "../types";
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
import { useExportCsv } from "../hooks/useExportCsv";
import { formatCurrency } from "../utils/currency";
import { PAYMENT_METHODS, MOBILE_MONEY_PROVIDERS, paymentLabel, providerLabel } from "../utils/payments";
import { statusBadge } from "../utils/statusBadges";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";

export default function Sales() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const [paymentFilter, setPaymentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState<Sale | null>(null);
  const [refundMethod, setRefundMethod] = useState("cash");
  const [refundProvider, setRefundProvider] = useState("m-pesa");
  const [refundPhone, setRefundPhone] = useState("");
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [printSelectedLoading, setPrintSelectedLoading] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const debouncedSearch = useDebounce(search, 300);
  const { exportCsv } = useExportCsv();

  const { data: channels } = useQuery({
    queryKey: ["sales-channels"],
    queryFn: async () => {
      const { data } = await api.get("/sales-channels/all");
      return data as SalesChannel[];
    },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sales", debouncedSearch, paymentFilter, statusFilter, channelFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (paymentFilter) params.payment_method = paymentFilter;
      if (statusFilter) params.status = statusFilter;
      if (channelFilter) params.channel_id = channelFilter;
      const { data } = await api.get("/sales", { params });
      return data as PaginatedResponse<Sale>;
    },
  });

  const refundMutation = useMutation({
    mutationFn: ({ id, method, provider }: { id: number; method?: string; provider?: string }) =>
      api.put(`/sales/${id}/refund`, { refund_method: method, refund_provider: provider }),
    onSuccess: () => {
      addToast("Sale refunded, stock restored", "success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Refund failed"), "error"),
  });

  const b2cRefundMutation = useMutation({
    mutationFn: async ({ sale, phone }: { sale: Sale; phone: string }) => {
      const { data } = await api.post("/daraja/b2c-refund", {
        phone: phone.trim(),
        amount: sale.total_amount,
        sale_id: sale.id,
        reference: sale.invoice_number,
        remarks: `Refund ${sale.invoice_number}`,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      if (data.success) {
        addToast("B2C refund initiated — money will be sent to customer", "success");
      } else {
        addToast(data.message || "B2C refund failed", "error");
      }
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "B2C refund failed"), "error");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.post(`/sales/${id}/cancel`),
    onSuccess: () => {
      addToast("Sale cancelled, stock restored", "success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cancellation failed"), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/sales/${id}`),
    onSuccess: () => {
      addToast("Sale deleted, stock restored", "success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Delete failed"), "error"),
  });

  const sales = data?.items || [];
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(sales);

  const bulkFields: BulkFieldConfig[] = [
    { name: "notes", label: "Notes", type: "text" },
  ];

  const handleExport = () => {
    exportCsv("/reports/export/sales", "sales_report.csv", "Sales report", debouncedSearch ? { search: debouncedSearch } : undefined);
  };

  const printPdf = (id: number) => {
    api.get(`/sales/${id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => addToast("Failed to generate PDF", "error"));
  };

  const bulkPrintPdf = async () => {
    if (selectedIds.size === 0) return;
    setPrintSelectedLoading(true);
    try {
      const { data } = await api.post("/sales/bulk-pdf", [...selectedIds], { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate combined PDF", "error");
    } finally {
      setPrintSelectedLoading(false);
    }
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
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by invoice number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search sales" />
        </div>
        <select
          className="select w-48"
          value={paymentFilter}
          onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
          aria-label="Filter by payment method"
        >
          <option value="">All payment methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select
          className="select w-40"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {channels && channels.length > 0 && (
          <select
            className="select w-40"
            value={channelFilter}
            onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
            aria-label="Filter by channel"
          >
            <option value="">All channels</option>
            {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </select>
        )}
      </div>

      <BulkActionBar count={selectedIds.size} canEdit={can("sales.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} onPrintSelected={bulkPrintPdf} printLoading={printSelectedLoading} />

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load sales")}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Sales table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3">
                <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all sales" />
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Invoice #</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Customer</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Channel</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Sold By</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Date</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Payment</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Location</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Total</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={10} />
            ) : sales.length === 0 ? (
              <EmptyState title="No sales yet" message="Record your first sale to start tracking revenue." actionLabel="New Sale" onAction={() => setShowForm(true)} />
            ) : sales.map((s) => (
              <tr key={s.id} className="hover:bg-app cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) setViewing(s); }}>
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} aria-label={`Select invoice ${s.invoice_number}`} />
                </td>
                <td className="px-4 py-3 font-medium">{s.invoice_number}</td>
                <td className="px-4 py-3 text-muted">{s.customer_name}</td>
                <td className="px-4 py-3 text-muted">{s.channel_name || "—"}</td>
                <td className="px-4 py-3 text-muted">{s.username || "—"}</td>
                <td className="px-4 py-3 text-muted">{formatDate(s.created_at)}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusBadge(s.status)}`}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-muted">{s.payment_method === "mobile_money" ? providerLabel(s.payment_provider) || paymentLabel(s.payment_method) : paymentLabel(s.payment_method)}</td>
                <td className="px-4 py-3 text-muted">{(s.locations ?? []).join(", ") || "—"}</td>
                <td className="px-4 py-3">{formatCurrency(s.total_amount, s.currency_symbol || currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(s)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View invoice ${s.invoice_number}`}>
                      <Eye size={16} />
                    </button>
                    <button onClick={() => printPdf(s.id)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Download invoice ${s.invoice_number}`}>
                      <FileText size={16} />
                    </button>
                    {s.status === "completed" && can("sales.refund") && (
                      <button onClick={() => { setRefunding(s); setRefundProvider(s.payment_provider || "m-pesa"); }} className="p-1 text-faint hover:text-orange-600 dark:text-orange-400" aria-label={`Refund ${s.invoice_number}`}>
                        <RotateCcw size={16} />
                      </button>
                    )}
                    {s.status === "pending" && s.payment_status === "failed" && can("sales.refund") && (
                      <button onClick={() => { setRefunding(s); setRefundProvider(s.payment_provider || "m-pesa"); }} className="p-1 text-faint hover:text-orange-600 dark:text-orange-400" aria-label={`Refund ${s.invoice_number}`}>
                        <RotateCcw size={16} />
                      </button>
                    )}
                    {s.status === "pending" && can("sales.refund") && (
                      <button onClick={() => setCancelling(s)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Cancel ${s.invoice_number}`}>
                        <XCircle size={16} />
                      </button>
                    )}
                    {(s.status === "pending" || s.status === "cancelled") && can("sales.refund") && (
                      <button onClick={() => setDeleting(s)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${s.invoice_number}`}>
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
        <SaleForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["sales"] });
            queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
          }}
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
        onConfirm={() => {
          if (refundMethod === "mobile_money" && refundPhone.trim()) {
            refundMutation.mutate({ id: refunding!.id, method: "mobile_money", provider: refundProvider }, {
              onSuccess: () => {
                b2cRefundMutation.mutate({ sale: refunding!, phone: refundPhone.trim() });
                setRefunding(null);
                setRefundPhone("");
              },
            });
          } else {
            refundMutation.mutate({ id: refunding!.id, method: refundMethod, provider: undefined });
            setRefunding(null);
            setRefundPhone("");
          }
        }}
        onCancel={() => { setRefunding(null); setRefundPhone(""); setRefundMethod("cash"); setRefundProvider("m-pesa"); }}
      >
        {refunding && (
          <div className="space-y-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Refund method</label>
              <select className="select text-sm w-full" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                <option value="cash">Cash</option>
                {PAYMENT_METHODS.filter((m) => m.value !== "cash").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {refundMethod === "mobile_money" && (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Provider</label>
                  <select className="select text-sm w-full" value={refundProvider} onChange={(e) => setRefundProvider(e.target.value)}>
                    {MOBILE_MONEY_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Customer phone (254XXXXXXXXX)</label>
                  <input className="input text-sm w-full" placeholder="e.g. 254712345678" value={refundPhone} onChange={(e) => setRefundPhone(e.target.value)} />
                </div>
              </>
            )}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!cancelling}
        title="Cancel Sale"
        message={`Cancel invoice "${cancelling?.invoice_number}" (${formatCurrency(cancelling?.total_amount ?? 0, currencySymbol)}) and restore stock? This cannot be undone.`}
        confirmLabel="Cancel Sale"
        confirmClass="btn-danger"
        onConfirm={() => {
          if (cancelling) cancelMutation.mutate(cancelling.id);
          setCancelling(null);
        }}
        onCancel={() => setCancelling(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete Sale"
        message={deleting?.status === "cancelled"
          ? `Permanently delete cancelled invoice "${deleting?.invoice_number}" (${formatCurrency(deleting?.total_amount ?? 0, currencySymbol)})? Stock was already restored. This cannot be undone.`
          : `Permanently delete invoice "${deleting?.invoice_number}" (${formatCurrency(deleting?.total_amount ?? 0, currencySymbol)}) and restore stock? This cannot be undone.`}
        confirmLabel="Delete"
        confirmClass="btn-danger"
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
