import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search, PackageOpen } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { useDebounce } from "../../hooks/useDebounce";
import Table from "../../components/Table";
import Pagination from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import { errorMessage } from "../../utils/errors";
import { formatCurrency } from "../../utils/currency";
import type { PaginatedResponse, PortalMe, Receipt } from "../../types";

export default function PortalReceipts() {
  const formatDate = useDateFormat();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedSearch = useDebounce(search, 300);

  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "receipts", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: String((page - 1) * pageSize),
        limit: String(pageSize),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/portal/receipts", { params });
      return data as PaginatedResponse<Receipt>;
    },
  });

  const rows = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <PackageOpen size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Deliveries</h1>
            <p className="text-sm text-muted mt-1 truncate">Deliveries recorded against your purchase orders.</p>
          </div>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load deliveries")}
        </div>
      )}

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          className="input pl-10"
          placeholder="Search by receipt number..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          aria-label="Search deliveries"
        />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table
            columns={[
              { key: "receipt", header: "Receipt", className: "px-4 py-3 font-medium text-muted" },
              { key: "reference", header: "Reference", className: "px-4 py-3 font-medium text-muted hidden sm:table-cell" },
              { key: "date", header: "Date", className: "px-4 py-3 font-medium text-muted hidden md:table-cell" },
              { key: "qty", header: "Qty", className: "px-4 py-3 font-medium text-muted text-right" },
              { key: "cost", header: "Value", className: "px-4 py-3 font-medium text-muted text-right" },
            ]}
            aria-label="Portal deliveries table"
            loading={isLoading}
            skeletonRows={6}
            noData={rows.length === 0}
            empty={
              <EmptyState
                icon={<PackageOpen size={48} />}
                title={search ? "No matching deliveries" : "No deliveries yet"}
                message={search ? "Try adjusting your search." : "Goods received against your purchase orders will appear here."}
              />
            }
          >
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-app cursor-pointer" onClick={() => navigate(`/portal/receipts/${r.id}`)}>
                <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{r.receipt_number}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap hidden sm:table-cell">{r.reference || "—"}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap hidden md:table-cell">{formatDate(r.created_at)}</td>
                <td className="px-4 py-3 text-right font-medium">{r.total_quantity}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.total_cost, me?.currency_symbol || "$")}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={data?.pages || 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />
    </div>
  );
}
