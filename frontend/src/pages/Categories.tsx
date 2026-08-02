import { useState } from "react";
import { Pencil, Trash2, Eye } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Category, PaginatedResponse } from "../types";
import CategoryDetail from "../components/CategoryDetail";
import CategoryForm from "../components/CategoryForm";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { exportCSV } from "../utils/csv";

const PAGE_SIZE = 25;

export default function Categories() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [viewing, setViewing] = useState<Category | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

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
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export categories to CSV">
            Export
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Category
          </button>
        </div>
      </div>

      {isError && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">Failed to load categories: {(error as any)?.message}</div>}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search categories" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Categories table">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 font-medium text-gray-600">Description</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <Skeleton rows={5} cols={3} />
            ) : categories.length === 0 ? (
              <EmptyState title="No categories" message="Create your first category to organize products." actionLabel="Add Category" onAction={() => { setEditing(null); setShowForm(true); }} />
            ) : categories.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-gray-500">{c.description}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(c)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View ${c.name}`}><Eye size={16} /></button>
                    <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Edit ${c.name}`}><Pencil size={16} /></button>
                    <button onClick={() => setDeleting(c)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Delete ${c.name}`}><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
