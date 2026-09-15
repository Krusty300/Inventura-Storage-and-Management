import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search, ClipboardList } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { useDebounce } from "../../hooks/useDebounce";
import { formatCurrency } from "../../utils/currency";
import { statusBadge } from "../../utils/statusBadges";
import Table from "../../components/Table";
import Pagination from "../../components/Pagination";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import FittedSelect from "../../components/FittedSelect";
import { errorMessage } from "../../utils/errors";
import type { Order, PaginatedResponse, PortalMe } from "../../types";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "approved", label: "Approved" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_transit", label: "In transit" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

export default function PortalOrders() {
  const formatDate = useDateFormat();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedSearch = useDebounce(search, 300);

  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "orders", debouncedSearch, status, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: String((page - 1) * pageSize),
        limit: String(pageSize),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      const { data } = await api.get("/portal/orders", { params });
      return data as PaginatedResponse<Order>;
    },
  });

  const rows = data?.items || [];
  const currencySymbol = me?.currency_symbol || "$";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ClipboardList size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Purchase Orders</h1>
            <p className="text-sm text-muted mt-1 truncate">Orders placed with {me?.supplier.name ?? "your company"}.</p>
          </div>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load orders")}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="input pl-10"
            placeholder="Search by order number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search orders"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted sm:col-span-1">
          <span className="whitespace-nowrap">Status</span>
          <FittedSelect
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={STATUS_OPTIONS}
            ariaLabel="Filter orders by status"
            maxWidth={220}
          />
        </label>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          {isLoading ? (
            <Skeleton variant="rows" rows={6} cols={5} />
          ) : (
            <Table
              columns={[
                { key: "order", header: "Order", className: "px-4 py-3 font-medium text-muted" },
                { key: "date", header: "Date", className: "px-4 py-3 font-medium text-muted hidden sm:table-cell" },
                { key: "expected", header: "Expected", className: "px-4 py-3 font-medium text-muted hidden md:table-cell" },
                { key: "status", header: "Status", className: "px-4 py-3 font-medium text-muted" },
                { key: "total", header: "Total", className: "px-4 py-3 font-medium text-muted text-right" },
              ]}
              aria-label="Portal purchase orders table"
              loading={false}
              skeletonRows={6}
              noData={rows.length === 0}
              empty={
                <EmptyState
                  title={search || status ? "No matching orders" : "No orders yet"}
                  message={search || status ? "Try adjusting your search or status filter." : "Approved purchase orders will appear here."}
                />
              }
            >
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-app cursor-pointer" onClick={() => navigate(`/portal/orders/${o.id}`)}>
                  <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{o.order_number}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap hidden sm:table-cell">{formatDate(o.created_at)}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap hidden md:table-cell">{o.expected_arrival ? formatDate(o.expected_arrival) : "—"}</td>
                  <td className="px-4 py-3"><span className={`badge ${statusBadge(o.status)}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(o.total_amount, currencySymbol)}</td>
                </tr>
              ))}
            </Table>
          )}
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