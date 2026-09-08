import { useState } from "react";
import { Search, Trash2, RotateCcw, XCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { TrashItem } from "../types";
import ConfirmDialog from "../components/ConfirmDialog";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import FittedSelect from "../components/FittedSelect";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useDateFormat } from "../hooks/useDateFormat";
import { errorMessage } from "../utils/errors";

const ENTITY_LABELS: Record<string, string> = {
  product: "Products",
  category: "Categories",
  customer: "Customers",
  customer_group: "Customer Groups",
  supplier: "Suppliers",
  location: "Locations",
  lpn: "LPNs",
  bom: "BOMs",
  kit: "Kits",
  price_list: "Price Lists",
  promotion: "Promotions",
  sales_channel: "Sales Channels",
  quality_check: "Quality Checks",
  user: "Users",
  note: "Notes",
  attachment: "Attachments",
};

function entityTypeLabel(key: string): string {
  return ENTITY_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Trash() {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [deleting, setDeleting] = useState<TrashItem | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);
  const formatDate = useDateFormat();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["trash", debouncedSearch, entityFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (entityFilter) params.entity_type = entityFilter;
      const { data } = await api.get("/trash", { params });
      return data as { items: TrashItem[]; counts: Record<string, number> };
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (item: TrashItem) => api.post(`/trash/${item.entity_type}/${item.id}/restore`),
    onSuccess: () => {
      addToast("Item restored", "success");
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot restore item"), "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: TrashItem) => api.delete(`/trash/${item.entity_type}/${item.id}`),
    onSuccess: () => {
      addToast("Item permanently deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      setDeleting(null);
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete item"), "error");
      setDeleting(null);
    },
  });

  const allItems = data?.items ?? [];
  const counts = data?.counts ?? {};
  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const items = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filterOptions = [
    { value: "", label: `All types (${allItems.length})` },
    ...Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => ({ value: k, label: `${entityTypeLabel(k)} (${c})` })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
            <Trash2 size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Trash</h1>
            <p className="text-sm text-muted mt-1">Restore or permanently delete soft-deleted items.</p>
          </div>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load trash")}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="input pl-10"
            placeholder="Search trash..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search trash"
          />
        </div>
        <FittedSelect
          value={entityFilter}
          onChange={(v) => { setEntityFilter(v); setPage(1); }}
          options={filterOptions}
          ariaLabel="Filter by entity type"
          maxWidth={240}
        />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Trash items">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Type</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Item</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Deleted</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={4} />
              ) : items.length === 0 ? (
                <EmptyState
                  icon={<Trash2 size={48} />}
                  title={debouncedSearch || entityFilter ? "No matching items" : "Trash is empty"}
                  message={debouncedSearch || entityFilter ? "Try a different search or filter." : "Nothing in the trash yet."}
                />
              ) : (
                items.map((item) => (
                  <tr key={`${item.entity_type}-${item.id}`} className="hover:bg-app">
                    <td className="px-4 py-3">
                      <span className="inline-block text-xs font-medium bg-app-alt px-2 py-0.5 rounded">
                        {entityTypeLabel(item.entity_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{item.label}</td>
                    <td className="px-4 py-3 text-muted">{item.deleted_at ? formatDate(item.deleted_at) : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {can("trash.restore") && (
                          <button
                            onClick={() => restoreMutation.mutate(item)}
                            className="p-1 text-faint hover:text-green-600 dark:text-green-400"
                            aria-label={`Restore ${item.label}`}
                            title="Restore"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                        {can("trash.delete") && (
                          <button
                            onClick={() => setDeleting(item)}
                            className="p-1 text-faint hover:text-red-600 dark:text-red-400"
                            aria-label={`Permanently delete ${item.label}`}
                            title="Delete permanently"
                          >
                            <XCircle size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? "bg-primary text-white" : "bg-app-alt text-muted hover:text-ink"}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Permanently"
        confirmLabel="Delete Permanently"
        message={`Are you sure you want to permanently delete "${deleting?.label}" (${entityTypeLabel(deleting?.entity_type ?? "")})? This action cannot be undone.`}
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
