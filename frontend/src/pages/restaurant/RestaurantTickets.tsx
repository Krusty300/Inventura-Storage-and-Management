import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UtensilsCrossed, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { PaginatedResponse, RestaurantTicket } from "../../types";
import Table from "../../components/Table";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import FittedSelect from "../../components/FittedSelect";
import RestaurantTicketDetailDrawer from "../../components/restaurant/RestaurantTicketDetailDrawer";
import { useDebounce } from "../../hooks/useDebounce";
import { usePageSize } from "../../hooks/usePageSize";
import { formatDateTime } from "../../utils/date";
import { useSettings } from "../../hooks/useSettings";
import { useAuth } from "../../context/AuthContext";
import { errorMessage } from "../../utils/errors";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "preparing", label: "Preparing" },
  { value: "ready", label: "Ready" },
  { value: "served", label: "Served" },
  { value: "paying", label: "Paying" },
  { value: "settled", label: "Settled" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_BADGE: Record<string, string> = {
  open: "badge-neutral",
  preparing: "badge-info",
  ready: "badge-warning",
  served: "badge-info",
  paying: "badge-warning",
  settled: "badge-success",
  cancelled: "badge-danger",
};

export default function RestaurantTickets() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<RestaurantTicket | null>(null);
  const { pageSize, setPageSize } = usePageSize();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-tickets", debouncedSearch, status, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: ((page - 1) * pageSize).toString(),
        limit: pageSize.toString(),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      const { data } = await api.get("/restaurant/tickets", { params });
      return data as PaginatedResponse<RestaurantTicket>;
    },
  });

  const tickets = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <UtensilsCrossed size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Tickets</h1>
            <p className="text-sm text-muted mt-1">Every check opened on the floor, takeaway included.</p>
          </div>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load tickets")}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-md flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="input pl-10"
            placeholder="Search ticket number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search tickets"
          />
        </div>
        <FittedSelect
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          ariaLabel="Filter by status"
          maxWidth={180}
          options={STATUS_FILTERS}
        />
      </div>

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Restaurant tickets"
          role="grid"
          columns={[
            { key: "ticket", header: "Ticket" },
            { key: "table", header: "Table" },
            { key: "status", header: "Status" },
            { key: "opened", header: "Opened" },
            { key: "total", header: "Total", className: "px-4 py-3 font-medium text-muted text-right" },
            { key: "actions", header: "", className: "px-4 py-3" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={tickets.length === 0}
          empty={
            <EmptyState
              variant="table"
              icon={<UtensilsCrossed size={48} />}
              title={debouncedSearch || status ? "No matching tickets" : "No tickets yet"}
              message={debouncedSearch || status ? "Try a different search or status filter." : "Open a ticket from the floor map or a takeaway order."}
            />
          }
        >
          {tickets.map((t) => (
            <tr
              key={t.id}
              className="hover:bg-app cursor-pointer"
              onClick={() => setDetail(t)}
            >
              <td className="px-4 py-3 font-medium">{t.ticket_number}</td>
              <td className="px-4 py-3 text-muted">{t.table_number}</td>
              <td className="px-4 py-3">
                <span className={`badge ${STATUS_BADGE[t.status] ?? "badge-neutral"}`}>{t.status}</span>
              </td>
              <td className="px-4 py-3 text-muted">{formatDateTime(t.opened_at)}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{symbol}{t.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td className="px-4 py-3 text-right">
                {t.status === "open" && can("restaurant.create") && (
                  <button className="btn-secondary text-xs px-2.5 py-1" onClick={(e) => { e.stopPropagation(); navigate(`/restaurant/tickets/${t.id}`); }}>
                    Order
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>

      <Pagination
        page={page}
        totalPages={data?.pages || 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />

      <RestaurantTicketDetailDrawer
        ticket={detail}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}