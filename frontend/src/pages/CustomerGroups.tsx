import { useState } from "react";
import { Pencil, Trash2, Search, UsersRound } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, CustomerGroup } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";

import EmptyState from "../components/EmptyState";
import FittedSelect from "../components/FittedSelect";
import TextArea from "../components/TextArea";
import Table from "../components/Table";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useDateFormat } from "../hooks/useDateFormat";
import { errorMessage } from "../utils/errors";

export default function CustomerGroups() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomerGroup | null>(null);
  const [deleting, setDeleting] = useState<CustomerGroup | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);
  const formatDate = useDateFormat();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customer-groups", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: ((page - 1) * pageSize).toString(),
        limit: pageSize.toString(),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/customer-groups", { params });
      return data as PaginatedResponse<CustomerGroup>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/customer-groups/${id}`),
    onSuccess: () => {
      addToast("Customer group deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["customer-groups"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete customer group"), "error");
    },
  });

  const groups = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <UsersRound size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Customer Groups</h1>
            <p className="text-sm text-muted mt-1">Group customers together to apply shared pricing and discounts.</p>
          </div>
        </div>
        {can("customer_groups.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Group
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load customer groups")}
        </div>
      )}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          className="input pl-10"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          aria-label="Search customer groups"
        />
      </div>

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Customer groups table"
          role="grid"
          columns={[
            { key: "name", header: "Name" },
            { key: "description", header: "Description" },
            { key: "count", header: "Customer Count" },
            { key: "created", header: "Created" },
            { key: "actions", header: "Actions" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={groups.length === 0}
          empty={
                <EmptyState
                  icon={<UsersRound size={48} />}
                  title={debouncedSearch ? "No matching groups" : "No customer groups"}
                  message={debouncedSearch ? `Nothing matched "${search}".` : "Create your first group to segment customers."}
                  actionLabel={!debouncedSearch && can("customer_groups.create") ? "Add Group" : undefined}
                  onAction={() => { setEditing(null); setShowForm(true); }}
                />
          }
        >
          {groups.map((g) => (
                  <tr key={g.id} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{g.name}</td>
                    <td className="px-4 py-3 text-muted">{g.description || "—"}</td>
                    <td className="px-4 py-3 text-muted">{g.customer_count}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(g.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {can("customer_groups.update") && (
                          <button
                            onClick={() => { setEditing(g); setShowForm(true); }}
                            className="p-1 text-faint hover:text-primary dark:text-primary"
                            aria-label={`Edit ${g.name}`}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {can("customer_groups.delete") && (
                          <button
                            onClick={() => setDeleting(g)}
                            className="p-1 text-faint hover:text-red-600 dark:text-red-400"
                            aria-label={`Delete ${g.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
        </Table>
      </div>

      <Pagination
        page={page}
        totalPages={data?.pages || 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />

      {showForm && (
        <CustomerGroupForm
          group={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["customer-groups"] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Customer Group"
        message={
          deleting?.customer_count
            ? `Are you sure you want to delete "${deleting?.name}"? ${deleting.customer_count} customer${deleting.customer_count === 1 ? "" : "s"} are assigned to this group. This action cannot be undone.`
            : `Are you sure you want to delete "${deleting?.name}"? This action cannot be undone.`
        }
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function CustomerGroupForm({ group, onClose, onSaved }: { group: CustomerGroup | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name || "");
  const [description, setDescription] = useState(group?.description || "");
  const [priceListId, setPriceListId] = useState<number | null>(group?.price_list_id ?? null);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const { data: priceLists = [] } = useQuery({
    queryKey: ["price-lists", "picker"],
    queryFn: async () => {
      const { data } = await api.get("/price-lists", { params: { limit: 500 } });
      return (data.items ?? []) as { id: number; name: string; is_default: boolean }[];
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        price_list_id: priceListId,
      };
      if (group) {
        await api.put(`/customer-groups/${group.id}`, payload);
        addToast(`Customer group "${payload.name}" updated`, "success");
      } else {
        await api.post("/customer-groups", payload);
        addToast(`Customer group "${payload.name}" created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving customer group"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={group ? `Edit ${group.name}` : "New Customer Group"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="cg-name" className="block text-sm font-medium text-ink mb-1">Name</label>
          <input
            id="cg-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wholesale"
            required
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="cg-description" className="block text-sm font-medium text-ink mb-1">Description</label>
          <TextArea
            id="cg-description"
            rows={2}
            value={description}
            onChange={setDescription}
            placeholder="Optional description of this group..."
          />
        </div>
        <div>
          <label htmlFor="cg-price-list" className="block text-sm font-medium text-ink mb-1">Price List</label>
          <FittedSelect
            value={priceListId ? String(priceListId) : ""}
            onChange={(v) => setPriceListId(v ? Number(v) : null)}
            ariaLabel="Assign price list"
            maxWidth={280}
            options={[{ value: "", label: "None (no price list)" }, ...priceLists.map((pl) => ({ value: String(pl.id), label: `${pl.name}${pl.is_default ? " (default)" : ""}` }))]}
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Save Group"}</button>
        </div>
      </form>
    </Modal>
  );
}
