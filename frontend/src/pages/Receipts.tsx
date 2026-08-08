import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Eye, PackagePlus, Printer } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Receipt } from "../types";
import ReceiptForm from "../components/ReceiptForm";
import ReceiptDetail from "../components/ReceiptDetail";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";

export default function Receipts() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<Receipt | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["receipts", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/receipts", { params });
      return data as PaginatedResponse<Receipt>;
    },
  });

  const receipts = data?.items || [];

  const handleExport = () => {
    exportCSV(
      ["Receipt #", "Supplier", "Date", "Qty", "Total Cost"],
      receipts.map((r) => [r.receipt_number, r.supplier_name, formatDate(r.created_at), r.total_quantity, r.total_cost]),
      "receipts"
    );
    addToast("Receipts exported to CSV", "success");
  };

  const printPdf = async (r: Receipt) => {
    try {
      const { data } = await api.get(`/receipts/${r.id}/pdf`, { responseType: "blob" });
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
        <h1 className="text-2xl font-bold text-ink">Receiving</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export receipts to CSV">Export</button>
          {can("receipts.create") && (
            <button onClick={() => setShowForm(true)} className="btn-primary">
              <PackagePlus size={16} className="inline mr-1" />Record Receipt
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by receipt number or reference..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search receipts" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Receipts table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3 font-medium text-muted">Receipt #</th>
              <th className="px-4 py-3 font-medium text-muted">Supplier</th>
              <th className="px-4 py-3 font-medium text-muted">Date</th>
              <th className="px-4 py-3 font-medium text-muted">Qty</th>
              <th className="px-4 py-3 font-medium text-muted">Total Cost</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={6} />
            ) : receipts.length === 0 ? (
              <EmptyState title="No receipts yet" message="Record receiving to bring stock into inventory." actionLabel="Record Receipt" onAction={() => setShowForm(true)} />
            ) : receipts.map((r) => (
              <tr key={r.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{r.receipt_number}</td>
                <td className="px-4 py-3 text-muted">{r.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-muted">{formatDate(r.created_at)}</td>
                <td className="px-4 py-3">{r.total_quantity}</td>
                <td className="px-4 py-3">{r.total_cost.toFixed(2)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => printPdf(r)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print receipt ${r.receipt_number}`}>
                      <Printer size={16} />
                    </button>
                    <button onClick={() => setViewing(r)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View receipt ${r.receipt_number}`}>
                      <Eye size={16} />
                    </button>
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
        <ReceiptForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["receipts"] }); queryClient.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}

      {viewing && <ReceiptDetail receipt={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
