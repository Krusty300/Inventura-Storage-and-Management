import { useState } from "react";
import { Pencil, Trash2, Store, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, SalesChannel } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import FittedSelect from "../components/FittedSelect";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";

const CHANNEL_TYPES = [
  { value: "store", label: "Store" },
  { value: "webstore", label: "Web Store" },
  { value: "marketplace", label: "Marketplace" },
  { value: "b2b", label: "B2B" },
];

const typeLabel = (t: string) => CHANNEL_TYPES.find((c) => c.value === t)?.label || t;

export default function SalesChannels() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SalesChannel | null>(null);
  const [deleting, setDeleting] = useState<SalesChannel | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sales-channels", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: ((page - 1) * pageSize).toString(),
        limit: pageSize.toString(),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/sales-channels", { params });
      return data as PaginatedResponse<SalesChannel>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/sales-channels/${id}`),
    onSuccess: () => {
      addToast("Sales channel deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["sales-channels"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete sales channel"), "error");
    },
  });

  const channels = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Store size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Sales Channels</h1>
            <p className="text-sm text-muted mt-1">Manage the channels you sell through.</p>
          </div>
        </div>
        {can("sales.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Channel
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load sales channels")}
        </div>
      )}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          className="input pl-10"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          aria-label="Search sales channels"
        />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Sales channels table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Name</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Type</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={4} />
              ) : channels.length === 0 ? (
                <EmptyState
                  icon={<Store size={48} />}
                  title={debouncedSearch ? "No matching channels" : "No sales channels"}
                  message={debouncedSearch ? `Nothing matched "${search}".` : "Create your first channel to track where sales come from."}
                  actionLabel={!debouncedSearch && can("sales.create") ? "Add Channel" : undefined}
                  onAction={() => { setEditing(null); setShowForm(true); }}
                />
              ) : (
                channels.map((ch) => (
                  <tr key={ch.id} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{ch.name}</td>
                    <td className="px-4 py-3 text-muted">{typeLabel(ch.type)}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${ch.is_active ? "badge-success" : "badge-neutral"}`}>
                        {ch.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {can("sales.create") && (
                          <button onClick={() => { setEditing(ch); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${ch.name}`}>
                            <Pencil size={16} />
                          </button>
                        )}
                        {can("sales.create") && (
                          <button onClick={() => setDeleting(ch)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${ch.name}`}>
                            <Trash2 size={16} />
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

      <Pagination
        page={page}
        totalPages={data?.pages || 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />

      {showForm && (
        <ChannelForm
          channel={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["sales-channels"] }); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Sales Channel"
        message={`Are you sure you want to delete "${deleting?.name}"? This action cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function ChannelForm({ channel, onClose, onSaved }: { channel: SalesChannel | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(channel?.name || "");
  const [type, setType] = useState(channel?.type || "store");
  const [isActive, setIsActive] = useState(channel?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: name.trim(), type, is_active: isActive };
      if (channel) {
        await api.put(`/sales-channels/${channel.id}`, payload);
        addToast(`Sales channel "${payload.name}" updated`, "success");
      } else {
        await api.post("/sales-channels", payload);
        addToast(`Sales channel "${payload.name}" created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to save sales channel"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={channel ? "Edit Channel" : "New Channel"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="ch-name">Name *</label>
          <input id="ch-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Main Store, Online Shop" maxLength={100} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="ch-type">Type</label>
          <FittedSelect
            value={type}
            onChange={setType}
            ariaLabel="ch-type"
            maxWidth={180}
            options={CHANNEL_TYPES.map((ct) => ({ value: ct.value, label: ct.label }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" className="rounded border-border-strong" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} id="ch-active" />
          <label htmlFor="ch-active" className="text-sm text-ink">Active</label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">{saving ? "Saving..." : channel ? "Update" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
