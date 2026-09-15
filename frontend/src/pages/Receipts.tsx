import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Eye, Printer, Search, Download, PackagePlus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Receipt } from "../types";
import ReceiptForm from "../components/ReceiptForm";
import ReceiptDetail from "../components/ReceiptDetail";
import Pagination from "../components/Pagination";

import EmptyState from "../components/EmptyState";
import Table from "../components/Table";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";

import { usePageSize } from "../hooks/usePageSize";

export default function Receipts() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [viewing, setViewing] = useState<Receipt | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data, isLoading, isError, error } = useQuery({
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
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <PackagePlus size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Receiving</h1>
            <p className="text-sm text-muted mt-1">Record inbound shipments and bring stock into inventory.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary inline-flex items-center gap-1" aria-label="Export receipts to CSV">
            <Download size={16} /> Download CSV
          </button>
          {can("receipts.create") && (
            <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-1">
              <PackagePlus size={16} /> Record Receipt
            </button>
          )}
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load receipts")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by receipt number or reference..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search receipts" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Receipts table"
          role="grid"
          headClassName="bg-subtle text-left"
          columns={[
            { key: "receipt", header: "Receipt #" },
            { key: "supplier", header: "Supplier" },
            { key: "date", header: "Date" },
            { key: "items", header: "Items" },
            { key: "qty", header: "Qty" },
            { key: "totalCost", header: "Total Cost" },
            { key: "actions", header: "Actions" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={receipts.length === 0}
          empty={
              <EmptyState title={search ? "No matching receipts" : "No receipts yet"} message={search ? `Nothing matched "${search}". Try adjusting your search.` : "Record receiving to bring stock into inventory."} actionLabel={search ? undefined : "Record Receipt"} onAction={search ? undefined : () => setShowForm(true)} />
          }
        >
          {receipts.map((r) => (
              <tr key={r.id} className="hover:bg-app cursor-pointer" onClick={(e) => { if ((e.target as HTMLElement).closest("button, input, select, a")) return; setViewing(r); }}>
                <td className="px-4 py-3 font-medium">{r.receipt_number}</td>
                <td className="px-4 py-3 text-muted">{r.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-muted">{formatDate(r.created_at)}</td>
                <td className="px-4 py-3">{r.items.length}</td>
                <td className="px-4 py-3">{r.total_quantity}</td>
                <td className="px-4 py-3">{formatCurrency(r.total_cost, currencySymbol)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => printPdf(r)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Print receipt ${r.receipt_number}`}>
                      <Printer size={16} />
                    </button>
                    <button onClick={() => setViewing(r)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View receipt ${r.receipt_number}`}>
                      <Eye size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
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
