import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse } from "../types";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";

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

const actionColors: Record<string, string> = {
  create: "badge-success",
  update: "badge-info",
  delete: "badge-danger",
};

const entityLabels: Record<string, string> = {
  product: "Product",
  category: "Category",
  supplier: "Supplier",
  customer: "Customer",
  order: "Order",
  stock_movement: "Stock Movement",
  user: "User",
};

const PAGE_SIZE = 25;

export default function ActivityLog() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const debouncedSearch = useDebounce(search, 300);

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
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
      </div>

      {isError && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">Failed to load activity log.</div>}

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by description..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search activity log" />
        </div>
        <select className="select w-44" value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }} aria-label="Filter by entity">
          <option value="">All Entities</option>
          {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select w-40" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} aria-label="Filter by action">
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
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">User</th>
                <th className="px-4 py-3 font-medium text-gray-600">Action</th>
                <th className="px-4 py-3 font-medium text-gray-600">Entity</th>
                <th className="px-4 py-3 font-medium text-gray-600">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <Skeleton rows={5} cols={5} />
              ) : logs.length === 0 ? (
                <EmptyState title="No activity recorded" message="Actions performed in the system will appear here." />
              ) : logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{log.username || `User #${log.user_id}`}</td>
                  <td className="px-4 py-3">
                    <span className={actionColors[log.action] || "badge-info"}>{log.action}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{entityLabels[log.entity_type] || log.entity_type}</td>
                  <td className="px-4 py-3 text-gray-700">{log.description}</td>
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
