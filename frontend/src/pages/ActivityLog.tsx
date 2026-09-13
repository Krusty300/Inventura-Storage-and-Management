import { useState } from "react";
import { History, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse } from "../types";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";
import FittedSelect from "../components/FittedSelect";
import Table from "../components/Table";
import { useDebounce } from "../hooks/useDebounce";
import { useExportCsv } from "../hooks/useExportCsv";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { statusBadge } from "../utils/statusBadges";

interface ActivityLogEntry {
  id: number;
  user_id: number;
  username: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  description: string;
  details: string;
  created_at: string;
}

const entityLabels: Record<string, string> = {
  product: "Product",
  category: "Category",
  supplier: "Supplier",
  customer: "Customer",
  order: "Order",
  stock_movement: "Stock Movement",
  user: "User",
};

import { usePageSize } from "../hooks/usePageSize";

export default function ActivityLog() {
  const formatDateTime = useDateTimeFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { exportCsv } = useExportCsv();

  const handleExport = () => {
    const params: Record<string, string> = {};
    if (entityFilter) params.entity_type = entityFilter;
    if (actionFilter) params.action = actionFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    exportCsv("/activity-logs/export", "activity_log_report.csv", "Activity log report", params);
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["activity-logs", page, entityFilter, actionFilter, debouncedSearch, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (entityFilter) params.entity_type = entityFilter;
      if (actionFilter) params.action = actionFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/activity-logs", { params });
      return data as PaginatedResponse<ActivityLogEntry>;
    },
  });

  const logs = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <History size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Activity Log</h1>
            <p className="text-sm text-muted mt-1">A chronological trail of every action taken across the warehouse.</p>
          </div>
        </div>
        <button onClick={handleExport} className="btn-secondary" aria-label="Export activity log to CSV">Export</button>
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load activity log.</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by description..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search activity log" />
        </div>
        <FittedSelect ariaLabel="Filter by entity" value={entityFilter} onChange={(v) => { setEntityFilter(v); setPage(1); }} options={[{ value: "", label: "All Entities" }, ...Object.entries(entityLabels).map(([k, v]) => ({ value: k, label: v }))]} />
        <FittedSelect ariaLabel="Filter by action" value={actionFilter} onChange={(v) => { setActionFilter(v); setPage(1); }} options={[{ value: "", label: "All Actions" }, { value: "create", label: "Create" }, { value: "update", label: "Update" }, { value: "delete", label: "Delete" }]} />
      </div>

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Activity log table"
          role="grid"
          columns={[
            { key: "date", header: "Date" },
            { key: "user", header: "User" },
            { key: "action", header: "Action" },
            { key: "entity", header: "Entity" },
            { key: "description", header: "Description" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={logs.length === 0}
          empty={
            <EmptyState title={search || entityFilter || actionFilter ? "No matching activity" : "No activity recorded"} message={search || entityFilter || actionFilter ? "Nothing matched your search or filters. Try adjusting them." : "Actions performed in the system will appear here."} />
          }
        >
          {logs.map((log) => (
                <tr key={log.id} className="hover:bg-app">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {formatDateTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-muted">{log.username || `User #${log.user_id}`}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusBadge(log.action)} capitalize`}>{log.action.replace("_", " ")}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{entityLabels[log.entity_type] || log.entity_type}</td>
                  <td className="px-4 py-3 text-ink">{log.description}</td>
                </tr>
              ))}
        </Table>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
}
