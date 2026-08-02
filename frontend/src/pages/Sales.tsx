import { useState } from "react";
import { Eye, RotateCcw, FileText } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Sale } from "../types";
import SaleForm from "../components/SaleForm";
import SaleDetail from "../components/SaleDetail";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useSettings } from "../hooks/useSettings";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

const PAGE_SIZE = 25;

export default function Sales() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);
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
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Refund failed", "error"),
  });

  const sales = data?.items || [];

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
        <h1 className="text-2xl font-bold text-gray-900">Sales</h1>
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

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Sales table">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Invoice #</th>
              <th className="px-4 py-3 font-medium text-gray-600">Customer</th>
              <th className="px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 font-medium text-gray-600">Payment</th>
              <th className="px-4 py-3 font-medium text-gray-600">Total</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : sales.length === 0 ? (
              <EmptyState title="No sales yet" message="Record your first sale to start tracking revenue." actionLabel="New Sale" onAction={() => setShowForm(true)} />
            ) : sales.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{s.invoice_number}</td>
                <td className="px-4 py-3 text-gray-500">{s.customer_name}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${s.status === "completed" ? "badge-success" : "badge-danger"}`}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 capitalize">{s.payment_method}</td>
                <td className="px-4 py-3">{formatCurrency(s.total_amount, currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(s)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View invoice ${s.invoice_number}`}>
                      <Eye size={16} />
                    </button>
                    <button onClick={() => printPdf(s.id)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Download invoice ${s.invoice_number}`}>
                      <FileText size={16} />
                    </button>
                    {s.status === "completed" && can("sales.refund") && (
                      <button onClick={() => setRefunding(s)} className="p-1 text-gray-400 hover:text-orange-600" aria-label={`Refund ${s.invoice_number}`}>
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
