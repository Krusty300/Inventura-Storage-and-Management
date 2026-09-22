import { useState } from "react";
import Table from "../components/Table";
import { Pencil, Trash2, Eye, RefreshCw, Search, Building2, ExternalLink, Phone, Mail, MapPin } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Supplier } from "../types";
import { useDateFormat } from "../hooks/useDateFormat";
import { daysAgo } from "../utils/date";
import SupplierForm from "../components/SupplierForm";
import SupplierDetail from "../components/SupplierDetail";
import SupplierImportModal from "../components/SupplierImportModal";
import HoverCard from "../components/HoverCard";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig } from "../components/EntityBulkEditModal";
import Pagination from "../components/Pagination";

import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";
import { entityImageUrl } from "../utils/images";
import { onImageError } from "../utils/placeholders";

function SupplierHoverCard({ supplier, onView }: { supplier: Supplier; onView: () => void }) {
  return (
    <div className="p-3 min-w-0">
      <div className="-mx-3 -mt-3 mb-3 h-24 bg-subtle flex items-center justify-center overflow-hidden">
        <img
          src={entityImageUrl(supplier.image_url)}
          alt=""
          className="w-full h-full object-contain p-2"
          loading="lazy"
          onError={onImageError}
          draggable={false}
        />
      </div>
      <p className="font-semibold text-ink leading-snug break-words">{supplier.name}</p>
      {supplier.contact_person && (
        <p className="mt-0.5 text-xs text-muted">Contact person: {supplier.contact_person}</p>
      )}
      <p className="mt-2 text-xs text-muted line-clamp-3 break-words">{supplier.notes || "No notes."}</p>
      <div className="mt-2 space-y-1 text-xs">
        {supplier.phone && (
          <div className="flex items-center gap-1.5 text-muted">
            <Phone size={12} className="text-faint shrink-0" />
            <a href={`tel:${supplier.phone}`} className="hover:text-primary dark:hover:text-primary">{supplier.phone}</a>
          </div>
        )}
        {supplier.email && (
          <div className="flex items-center gap-1.5 text-muted">
            <Mail size={12} className="text-faint shrink-0" />
            <a href={`mailto:${supplier.email}`} className="hover:text-primary dark:hover:text-primary truncate">{supplier.email}</a>
          </div>
        )}
        {supplier.address && (
          <div className="flex items-center gap-1.5 text-muted">
            <MapPin size={12} className="text-faint shrink-0" />
            <span className="truncate">{supplier.address}</span>
          </div>
        )}
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-border flex justify-end">
        <button type="button" onClick={onView} className="btn-primary inline-flex items-center gap-1.5 text-xs px-3 py-1.5">
          View Details
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}

export default function Suppliers() {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const showSupplierCards = settings?.show_supplier_hover_cards ?? true;
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
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
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot deactivate supplier"), "error");
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
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(suppliers);

  const recencyClass = (date: string | null) => {
    if (!date) return "text-muted";
    const days = daysAgo(date);
    if (days <= 30) return "text-emerald-600 dark:text-emerald-400";
    if (days <= 90) return "text-muted";
    return "text-amber-600 dark:text-amber-400";
  };

  const bulkFields: BulkFieldConfig[] = [
    { name: "contact_person", label: "Contact Person", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "phone", label: "Phone", type: "text" },
    { name: "address", label: "Address", type: "text" },
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
      ["Name", "Contact", "Email", "Phone", "Address", "Orders", "Total Spent"],
      suppliers.map((s) => [s.name, s.contact_person, s.email, s.phone, s.address, s.total_orders ?? 0, s.total_spent ?? 0]),
      "suppliers"
    );
    addToast("Suppliers exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Building2 size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Suppliers</h1>
            <p className="text-sm text-muted mt-1">Manage the companies you buy from.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
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

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load suppliers")}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by name, contact, or email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search suppliers" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-primary"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
          />
          Show inactive
        </label>
      </div>

      <BulkActionBar count={selectedIds.size} canEdit={can("suppliers.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <Table
          columns={[
            { key: 'select', header: <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all suppliers" />, className: 'px-4 py-3' },
            { key: 'name', header: 'Name', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'contact', header: 'Contact', className: 'px-4 py-3 font-medium text-muted hidden md:table-cell' },
            { key: 'email', header: 'Email', className: 'px-4 py-3 font-medium text-muted hidden lg:table-cell' },
            { key: 'phone', header: 'Phone', className: 'px-4 py-3 font-medium text-muted hidden lg:table-cell' },
            { key: 'products', header: 'Products', className: 'px-4 py-3 font-medium text-muted text-right' },
            { key: 'orders', header: 'Orders', className: 'px-4 py-3 font-medium text-muted text-right hidden md:table-cell' },
            { key: 'totalSpent', header: 'Total Spent', className: 'px-4 py-3 font-medium text-muted text-right' },
            { key: 'lastOrder', header: 'Last Order', className: 'px-4 py-3 font-medium text-muted hidden sm:table-cell' },
            { key: 'actions', header: 'Actions', className: 'px-4 py-3 font-medium text-muted' },
          ]}
          aria-label="Suppliers table"
          loading={isLoading}
          skeletonRows={5}
          noData={suppliers.length === 0}
          empty={<EmptyState icon={<Building2 size={48} />} title={search ? "No matching suppliers" : "No suppliers"} message={search ? `Nothing matched "${search}". Try adjusting your search.` : "Add your first supplier to start managing purchases."} actionLabel={search ? undefined : "Add Supplier"} onAction={search ? undefined : () => { setEditing(null); setShowForm(true); }} />}
        >
            {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-app cursor-pointer" onClick={(e) => { const t = e.target as HTMLElement; if (t.closest("button") || t.closest("input") || t.closest("a")) return; setViewing(s); }}>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} aria-label={`Select ${s.name}`} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={entityImageUrl(s.image_url)}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover border border-border bg-subtle shrink-0"
                        loading="lazy"
                        onError={onImageError}
                      />
                      {showSupplierCards ? (
                        <HoverCard
                          width={320}
                          render={(close) => (
                            <SupplierHoverCard supplier={s} onView={() => { close(); setViewing(s); }} />
                          )}
                        >
                          <span className="truncate max-w-[180px]">{s.name}</span>
                        </HoverCard>
                      ) : (
                        <span className="truncate max-w-[180px]">{s.name}</span>
                      )}
                      {!s.is_active && <span className="badge badge-warning shrink-0">Inactive</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted hidden md:table-cell">
                    <div className="truncate max-w-[120px]">{s.contact_person || "—"}</div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="truncate max-w-[200px]">
                      {s.email ? <a href={`mailto:${s.email}`} className="hover:text-primary dark:hover:text-primary">{s.email}</a> : <span className="text-muted">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell whitespace-nowrap">
                    {s.phone ? <a href={`tel:${s.phone}`} className="hover:text-primary dark:hover:text-primary">{s.phone}</a> : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted text-right">{(s.product_count ?? 0).toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right hidden md:table-cell ${(s.total_orders ?? 0) === 0 ? "text-amber-600 dark:text-amber-400" : "text-muted"}`}>{(s.total_orders ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-muted text-right">{formatCurrency(s.total_spent ?? 0, currencySymbol)}</td>
                  <td className={`px-4 py-3 ${recencyClass(s.last_order_at ?? null)} hidden sm:table-cell whitespace-nowrap`}>
                    {s.last_order_at ? formatDate(s.last_order_at) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => setViewing(s)} className="p-2 rounded-md text-faint hover:text-primary dark:text-primary hover:bg-app" aria-label={`View ${s.name}`}><Eye size={16} /></button>
                      {!s.is_active && can("suppliers.update") && (
                        <button onClick={() => restoreMutation.mutate(s.id)} className="p-2 rounded-md text-faint hover:text-green-600 dark:text-green-400 hover:bg-app" aria-label={`Restore ${s.name}`}>
                          <RefreshCw size={16} />
                        </button>
                      )}
                      <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-2 rounded-md text-faint hover:text-primary dark:text-primary hover:bg-app" aria-label={`Edit ${s.name}`}><Pencil size={16} /></button>
                      <button onClick={() => setDeleting(s)} className="p-2 rounded-md text-faint hover:text-red-600 dark:text-red-400 hover:bg-app" aria-label={`Delete ${s.name}`}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
          </Table>
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

      {viewing && (
        <SupplierDetail
          supplier={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setShowForm(true); setViewing(null); }}
        />
      )}

      {showBulkEdit && (
        <EntityBulkEditModal
          ids={[...selectedIds]}
          entityLabel="Supplier"
          endpoint="/suppliers/bulk-edit"
          fields={bulkFields}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ["suppliers"] });
            addToast("Suppliers updated", "success");
          }}
        />
      )}

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
