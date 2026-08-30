import { useState } from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse } from "../types";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
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
        <h1 className="text-2xl font-bold text-ink">Activity Log</h1>
        <button onClick={handleExport} className="btn-secondary" aria-label="Export activity log to CSV">Export</button>
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load activity log.</div>}

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by description..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search activity log" />
        </div>
        <select className="select w-44" value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }} aria-label="Filter by entity">
          <option value="">All Entities</option>
          {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select w-44" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} aria-label="Filter by action">
          <option value="">All Actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Activity log table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Date</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">User</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Action</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Entity</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={5} />
              ) : logs.length === 0 ? (
                <EmptyState title="No activity recorded" message="Actions performed in the system will appear here." />
              ) : logs.map((log) => (
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
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
}
