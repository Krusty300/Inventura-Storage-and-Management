import { useState } from "react";
import { Pencil, Trash2, Eye } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Category, PaginatedResponse } from "../types";
import CategoryDetail from "../components/CategoryDetail";
import CategoryForm from "../components/CategoryForm";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig, type BulkFieldOption } from "../components/EntityBulkEditModal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";

import { usePageSize } from "../hooks/usePageSize";

export default function Categories() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [viewing, setViewing] = useState<Category | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data: allCategories } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: async () => {
      const { data } = await api.get("/categories", { params: { limit: PAGE_SIZE_PRODUCTS } });
      return (data as PaginatedResponse<Category>).items;
    },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["categories", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/categories", { params });
      return data as PaginatedResponse<Category>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}`),
    onSuccess: () => {
      addToast("Category deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Cannot delete category", "error");
    },
  });

  const categories = data?.items || [];
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(categories);

  const parentOptions: BulkFieldOption[] = [
    { value: "__none__", label: "No parent (top-level)" },
    ...(allCategories || [])
      .filter((c) => !selectedIds.has(c.id))
      .map((c) => ({ value: String(c.id), label: c.name })),
  ];

  const bulkFields: BulkFieldConfig[] = [
    { name: "description", label: "Description", type: "text" },
    { name: "parent_id", label: "Parent", type: "select", options: parentOptions, clearValue: "__none__", valueType: "number" },
  ];

  const handleExport = () => {
    exportCSV(
      ["Name", "Description"],
      categories.map((c) => [c.name, c.description]),
      "categories"
    );
    addToast("Categories exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Categories</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export categories to CSV">
            Export
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Category
          </button>
        </div>
      </div>

      {isError && <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load categories: {(error as any)?.message}</div>}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search categories" />
        </div>
      </div>

      <BulkActionBar count={selectedIds.size} canEdit={can("categories.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Categories table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3">
                <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all categories" />
              </th>
              <th className="px-4 py-3 font-medium text-muted">Name</th>
              <th className="px-4 py-3 font-medium text-muted">Description</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={4} />
            ) : categories.length === 0 ? (
              <EmptyState title="No categories" message="Create your first category to organize products." actionLabel="Add Category" onAction={() => { setEditing(null); setShowForm(true); }} />
            ) : categories.map((c) => (
              <tr key={c.id} className="hover:bg-app">
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={`Select ${c.name}`} />
                </td>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-muted">{c.description}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(c)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${c.name}`}><Eye size={16} /></button>
                    <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${c.name}`}><Pencil size={16} /></button>
                    <button onClick={() => setDeleting(c)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${c.name}`}><Trash2 size={16} /></button>
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
        <CategoryForm
          category={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["categories"] }); }}
        />
      )}

      {viewing && <CategoryDetail category={viewing} onClose={() => setViewing(null)} />}

      {showBulkEdit && (
        <EntityBulkEditModal
          ids={[...selectedIds]}
          entityLabel="Category"
          endpoint="/categories/bulk-edit"
          fields={bulkFields}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            addToast("Categories updated", "success");
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Category"
        message={`Are you sure you want to delete "${deleting?.name}"? This action cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
