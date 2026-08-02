import { useState } from "react";
import { Pencil, Trash2, Eye, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Supplier } from "../types";
import SupplierForm from "../components/SupplierForm";
import SupplierDetail from "../components/SupplierDetail";
import SupplierImportModal from "../components/SupplierImportModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";

const PAGE_SIZE = 25;

export default function Suppliers() {
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["suppliers", debouncedSearch, includeInactive, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (includeInactive) params.include_inactive = "true";
      const { data } = await api.get("/suppliers", { params });
      return data as PaginatedResponse<Supplier>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/suppliers/${id}`),
    onSuccess: () => {
      addToast("Supplier deactivated", "success");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Cannot deactivate supplier", "error");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => api.post(`/suppliers/${id}/restore`),
    onSuccess: () => {
      addToast("Supplier restored", "success");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: () => addToast("Failed to restore supplier", "error"),
  });

  const suppliers = data?.items || [];

  const handleExport = () => {
    exportCSV(
      ["Name", "Contact", "Email", "Phone", "Address", "Orders", "Total Spent"],
      suppliers.map((s) => [s.name, s.contact_person, s.email, s.phone, s.address, s.total_orders ?? 0, s.total_spent ?? 0]),
      "suppliers"
    );
    addToast("Suppliers exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <div className="flex gap-2">
          {can("suppliers.import") && (
            <button onClick={() => setShowImport(true)} className="btn-secondary" aria-label="Import suppliers from CSV">
              Import
            </button>
          )}
          <button onClick={handleExport} className="btn-secondary" aria-label="Export suppliers to CSV">
            Export
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Supplier
          </button>
        </div>
      </div>

      {isError && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">Failed to load suppliers: {(error as any)?.message}</div>}

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by name, contact, or email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search suppliers" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
          />
          Show inactive
        </label>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Suppliers table">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Contact</th>
                <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 font-medium text-gray-600">Products</th>
                <th className="px-4 py-3 font-medium text-gray-600">Orders</th>
                <th className="px-4 py-3 font-medium text-gray-600">Total Spent</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <Skeleton rows={5} cols={8} />
              ) : suppliers.length === 0 ? (
                <EmptyState title="No suppliers" message="Add your first supplier to start managing purchases." actionLabel="Add Supplier" onAction={() => { setEditing(null); setShowForm(true); }} />
              ) : suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    {s.name}
                    {!s.is_active && <span className="badge badge-warning ml-2">Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.contact_person}</td>
                  <td className="px-4 py-3 text-gray-500">{s.email}</td>
                  <td className="px-4 py-3 text-gray-500">{s.phone}</td>
                  <td className="px-4 py-3 text-gray-500">{s.product_count ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500">{s.total_orders ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500">{formatCurrency(s.total_spent ?? 0)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setViewing(s)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View ${s.name}`}><Eye size={16} /></button>
                      {!s.is_active && can("suppliers.update") && (
                        <button onClick={() => restoreMutation.mutate(s.id)} className="p-1 text-gray-400 hover:text-green-600" aria-label={`Restore ${s.name}`}>
                          <RefreshCw size={16} />
                        </button>
                      )}
                      <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Edit ${s.name}`}><Pencil size={16} /></button>
                      <button onClick={() => setDeleting(s)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Delete ${s.name}`}><Trash2 size={16} /></button>
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
        <SupplierForm
          supplier={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["suppliers"] }); }}
        />
      )}

      {showImport && (
        <SupplierImportModal
          onClose={() => setShowImport(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["suppliers"] })}
        />
      )}

      {viewing && <SupplierDetail supplier={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Deactivate Supplier"
        message={`Are you sure you want to deactivate "${deleting?.name}"? They will be hidden from the active list and can be restored later.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
