import { useState } from "react";
import { Pencil, Trash2, Eye, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Customer, PaginatedResponse } from "../types";
import CustomerDetail from "../components/CustomerDetail";
import CustomerForm from "../components/CustomerForm";
import CustomerImportModal from "../components/CustomerImportModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";

const PAGE_SIZE = 25;

export default function Customers() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customers", debouncedSearch, typeFilter, includeInactive, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (typeFilter) params.customer_type = typeFilter;
      if (includeInactive) params.include_inactive = "true";
      const { data } = await api.get("/customers", { params });
      return data as PaginatedResponse<Customer>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      addToast("Customer deactivated", "success");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: () => addToast("Failed to deactivate customer", "error"),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => api.post(`/customers/${id}/restore`),
    onSuccess: () => {
      addToast("Customer restored", "success");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: () => addToast("Failed to restore customer", "error"),
  });

  const customers = data?.items || [];

  const handleExport = () => {
    exportCSV(
      ["Name", "Phone", "Email", "Address", "Type", "Notes", "Total Sales", "Total Spent"],
      customers.map((c) => [c.name, c.phone, c.email, c.address, c.customer_type, c.notes, c.total_sales ?? 0, c.total_spent ?? 0]),
      "customers"
    );
    addToast("Customers exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Customers</h1>
        <div className="flex gap-2">
          {can("customers.import") && (
            <button onClick={() => setShowImport(true)} className="btn-secondary" aria-label="Import customers from CSV">
              Import
            </button>
          )}
          <button onClick={handleExport} className="btn-secondary" aria-label="Export customers to CSV">
            Export
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Customer
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input
            className="input pl-10"
            placeholder="Search by name, phone, or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search customers"
          />
        </div>
        <select
          className="select w-44"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          aria-label="Filter by type"
        >
          <option value="">All Types</option>
          <option value="frequent">Frequent</option>
          <option value="walk-in">Walk-in</option>
        </select>
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

      {isError && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">Failed to load customers: {(error as any)?.message}</div>}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Customers table">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 font-medium text-gray-600">Orders</th>
                <th className="px-4 py-3 font-medium text-gray-600">Total Spent</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Purchase</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <Skeleton rows={5} cols={8} />
              ) : customers.length === 0 ? (
                <EmptyState title="No customers found" message="Add your first customer to get started." actionLabel="Add Customer" onAction={() => { setEditing(null); setShowForm(true); }} />
              ) : customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    {c.name}
                    {!c.is_active && <span className="badge badge-warning ml-2">Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.phone}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${c.customer_type === "frequent" ? "badge-success" : "badge-info"}`}>
                      {c.customer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.total_sales ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500">{formatCurrency(c.total_spent ?? 0)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setViewing(c)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View ${c.name}`}><Eye size={16} /></button>
                      {!c.is_active && can("customers.update") && (
                        <button onClick={() => restoreMutation.mutate(c.id)} className="p-1 text-gray-400 hover:text-green-600" aria-label={`Restore ${c.name}`}>
                          <RefreshCw size={16} />
                        </button>
                      )}
                      <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Edit ${c.name}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => setDeleting(c)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Delete ${c.name}`}>
                        <Trash2 size={16} />
                      </button>
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
        <CustomerForm
          customer={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["customers"] }); }}
        />
      )}

      {showImport && (
        <CustomerImportModal
          onClose={() => setShowImport(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["customers"] })}
        />
      )}

      {viewing && <CustomerDetail customer={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Deactivate Customer"
        message={`Are you sure you want to deactivate "${deleting?.name}"? They will be hidden from the active list and can be restored later.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
