import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Pencil, Trash2, Eye, RefreshCw, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Customer, PaginatedResponse } from "../types";
import CustomerDetail from "../components/CustomerDetail";
import CustomerForm from "../components/CustomerForm";
import CustomerImportModal from "../components/CustomerImportModal";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig } from "../components/EntityBulkEditModal";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { useDebounce } from "../hooks/useDebounce";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { parseLocalDate } from "../utils/date";

import { usePageSize } from "../hooks/usePageSize";

export default function Customers() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [typeFilter, setTypeFilter] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
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
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(customers);

  const recencyClass = (date: string | null | undefined) => {
    if (!date) return "text-muted";
    const days = Math.floor((Date.now() - parseLocalDate(date).getTime()) / 86400000);
    if (days <= 30) return "text-emerald-600 dark:text-emerald-400";
    if (days <= 90) return "text-muted";
    return "text-amber-600 dark:text-amber-400";
  };

  const bulkFields: BulkFieldConfig[] = [
    { name: "phone", label: "Phone", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "address", label: "Address", type: "text" },
    {
      name: "customer_type",
      label: "Type",
      type: "select",
      options: [
        { value: "frequent", label: "Frequent" },
        { value: "walk-in", label: "Walk-in" },
      ],
    },
    { name: "notes", label: "Notes", type: "text" },
    {
      name: "is_active",
      label: "Status",
      type: "select",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
      valueType: "boolean",
    },
  ];

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
        <h1 className="text-2xl font-bold text-ink">Customers</h1>
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
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
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
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
          />
          Show inactive
        </label>
      </div>

      <BulkActionBar count={selectedIds.size} canEdit={can("customers.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />

      {isError && <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load customers: {(error as any)?.message}</div>}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Customers table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all customers" />
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Name</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Email</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Type</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Orders</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Total Spent</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Avg Order</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Last Purchase</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={10} />
              ) : customers.length === 0 ? (
                <EmptyState title="No customers found" message="Add your first customer to get started." actionLabel="Add Customer" onAction={() => { setEditing(null); setShowForm(true); }} />
              ) : customers.map((c) => (
                <tr key={c.id} className="hover:bg-app cursor-pointer" onClick={(e) => { const t = e.target as HTMLElement; if (t.closest("button") || t.closest("input")) return; setViewing(c); }}>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={`Select ${c.name}`} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {c.name}
                    {!c.is_active && <span className="badge badge-warning ml-2">Inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    {c.phone ? <a href={`tel:${c.phone}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">{c.phone}</a> : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {c.email ? <a href={`mailto:${c.email}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">{c.email}</a> : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${c.customer_type === "frequent" ? "badge-success" : "badge-info"}`}>
                      {c.customer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.total_sales ?? 0}</td>
                  <td className="px-4 py-3 text-muted">{formatCurrency(c.total_spent ?? 0)}</td>
                  <td className="px-4 py-3 text-muted">
                    {c.total_sales ? formatCurrency((c.total_spent ?? 0) / c.total_sales) : "—"}
                  </td>
                  <td className={`px-4 py-3 ${recencyClass(c.last_purchase_at)}`}>
                    {c.last_purchase_at ? formatDate(c.last_purchase_at) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setViewing(c)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${c.name}`}><Eye size={16} /></button>
                      {!c.is_active && can("customers.update") && (
                        <button onClick={() => restoreMutation.mutate(c.id)} className="p-1 text-faint hover:text-green-600 dark:text-green-400" aria-label={`Restore ${c.name}`}>
                          <RefreshCw size={16} />
                        </button>
                      )}
                      <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${c.name}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => setDeleting(c)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${c.name}`}>
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

      {showBulkEdit && (
        <EntityBulkEditModal
          ids={[...selectedIds]}
          entityLabel="Customer"
          endpoint="/customers/bulk-edit"
          fields={bulkFields}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ["customers"] });
            addToast("Customers updated", "success");
          }}
        />
      )}

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
