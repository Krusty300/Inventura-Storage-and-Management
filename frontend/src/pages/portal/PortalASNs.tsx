import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search, PackageCheck } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { useDebounce } from "../../hooks/useDebounce";
import { statusBadge } from "../../utils/statusBadges";
import Table from "../../components/Table";
import Pagination from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import FittedSelect from "../../components/FittedSelect";
import { errorMessage } from "../../utils/errors";
import type { ASN, PaginatedResponse, PortalMe } from "../../types";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

export default function PortalASNs() {
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
    queryKey: ["portal", "asns", debouncedSearch, status, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: String((page - 1) * pageSize),
        limit: String(pageSize),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      const { data } = await api.get("/portal/asns", { params });
      return data as PaginatedResponse<ASN>;
    },
  });

  const rows = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <PackageCheck size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Shipments</h1>
            <p className="text-sm text-muted mt-1 truncate">Advance shipping notices for {me?.supplier.name ?? "your company"}.</p>
          </div>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load shipments")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-center">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="input pl-10"
            placeholder="Search by ASN number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search shipments"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="whitespace-nowrap">Status</span>
          <FittedSelect
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={STATUS_OPTIONS}
            ariaLabel="Filter shipments by status"
            maxWidth={220}
          />
        </label>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table
            columns={[
              { key: "asn", header: "ASN", className: "px-4 py-3 font-medium text-muted" },
              { key: "order", header: "Order", className: "px-4 py-3 font-medium text-muted hidden sm:table-cell" },
              { key: "expected", header: "Expected", className: "px-4 py-3 font-medium text-muted hidden md:table-cell" },
              { key: "status", header: "Status", className: "px-4 py-3 font-medium text-muted" },
              { key: "qty", header: "Qty", className: "px-4 py-3 font-medium text-muted text-right" },
            ]}
            aria-label="Portal shipments table"
            loading={isLoading}
            skeletonRows={6}
            noData={rows.length === 0}
            empty={
              <EmptyState
                icon={<PackageCheck size={48} />}
                title={search || status ? "No matching shipments" : "No shipments yet"}
                message={search || status ? "Try adjusting your search or status filter." : "Shipments raised against your purchase orders will appear here."}
              />
            }
          >
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-app cursor-pointer" onClick={() => navigate(`/portal/asns/${a.id}`)}>
                <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{a.asn_number}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap hidden sm:table-cell">{a.order_number ?? "—"}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap hidden md:table-cell">{a.expected_arrival ? formatDate(a.expected_arrival) : "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(a.status)}`}>{STATUS_LABEL[a.status] ?? a.status}</span></td>
                <td className="px-4 py-3 text-right font-medium">{a.total_expected}</td>
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