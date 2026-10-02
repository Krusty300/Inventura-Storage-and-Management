import { useState } from "react";
import { Pencil, Trash2, Store, MapPin } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantTable } from "../../types";
import Table from "../../components/Table";
import EmptyState from "../../components/EmptyState";
import ConfirmDialog from "../../components/ConfirmDialog";
import SlideOver from "../../components/SlideOver";
import { PanelCard, PanelField, PanelFooter, PanelHeader, PanelSection } from "../../components/Panel";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { errorMessage } from "../../utils/errors";

export default function RestaurantTables() {
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [deleting, setDeleting] = useState<RestaurantTable | null>(null);

  const { data: tables, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-tables"],
    queryFn: async () => {
      const { data } = await api.get("/restaurant/tables");
      return data as RestaurantTable[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/restaurant/tables/${id}`),
    onSuccess: () => {
      addToast("Table deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete table"), "error"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <MapPin size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Tables</h1>
            <p className="text-sm text-muted mt-1">Design your floor plan — zones, seating, and table numbers.</p>
          </div>
        </div>
        {can("restaurant.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Table
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load tables")}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Restaurant tables"
          role="grid"
          columns={[
            { key: "number", header: "Table" },
            { key: "zone", header: "Zone" },
            { key: "capacity", header: "Capacity", className: "px-4 py-3 font-medium text-muted text-right" },
            { key: "status", header: "Status" },
            { key: "actions", header: "", className: "px-4 py-3" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={(tables ?? []).length === 0}
          empty={
            <EmptyState
              variant="table"
              icon={<Store size={48} />}
              title="No tables yet"
              message="Add tables to lay out your floor plan."
              actionLabel={can("restaurant.create") ? "Add Table" : undefined}
              onAction={() => { setEditing(null); setShowForm(true); }}
            />
          }
        >
          {(tables ?? []).map((t) => (
            <tr key={t.id} className="hover:bg-app">
              <td className="px-4 py-3 font-medium">{t.number}</td>
              <td className="px-4 py-3 text-muted">{t.zone || "—"}</td>
              <td className="px-4 py-3 text-right">{t.capacity}</td>
              <td className="px-4 py-3">
                <span className={`badge ${t.is_active ? (t.status === "occupied" ? "badge-warning" : "badge-success") : "badge-neutral"}`}>
                  {!t.is_active ? "Inactive" : t.status === "occupied" ? "Occupied" : "Available"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex gap-2 justify-end">
                  {can("restaurant.update") && (
                    <button onClick={() => { setEditing(t); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${t.number}`}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {can("restaurant.delete") && (
                    <button onClick={() => setDeleting(t)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${t.number}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>

      {showForm && (
        <TableForm
          table={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] });
            queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Table"
        message={`Delete table "${deleting?.number}"? Tables that have been used on tickets cannot be deleted.`}
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function TableForm({ table, onClose, onSaved }: { table: RestaurantTable | null; onClose: () => void; onSaved: () => void }) {
  const [number, setNumber] = useState(table?.number ?? "");
  const [zone, setZone] = useState(table?.zone ?? "Main");
  const [capacity, setCapacity] = useState(table?.capacity ?? 4);
  const [isActive, setIsActive] = useState(table?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { number: number.trim(), zone: zone.trim(), capacity, is_active: isActive };
      if (table) {
        await api.put(`/restaurant/tables/${table.id}`, payload);
        addToast(`Table "${payload.number}" updated`, "success");
      } else {
        await api.post("/restaurant/tables", payload);
        addToast(`Table "${payload.number}" created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to save table"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title={table ? `Edit Table ${table.number}` : "New Table"}
      breadcrumb={table ? `Edit table ${table.number}` : "New table"}
    >
      <PanelCard>
        <PanelHeader
          eyebrow={table ? "Edit Table" : "New Table"}
          title={table ? `Table ${table.number}` : "New table"}
        />
        <form id="table-form" onSubmit={handleSubmit} className="space-y-0">
          <PanelSection label="Table Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PanelField label="Table number *" htmlFor="table-number">
                <input id="table-number" className="input" value={number} onChange={(e) => setNumber(e.target.value)} required placeholder="e.g. T1, Bar 2, 12" maxLength={20} />
              </PanelField>
              <PanelField label="Seats" htmlFor="table-capacity">
                <input id="table-capacity" className="input" value={capacity} onChange={(e) => setCapacity(Math.max(1, parseInt(e.target.value) || 1))} type="number" min={1} max={50} />
              </PanelField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <PanelField label="Zone" htmlFor="table-zone">
                <input id="table-zone" className="input" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Main, Terrace, Bar" maxLength={100} />
              </PanelField>
              <div className="flex items-end pb-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded border-border-strong" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} id="table-active" />
                  <label htmlFor="table-active" className="text-sm text-ink">Active</label>
                </div>
              </div>
            </div>
          </PanelSection>
          <PanelFooter>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !number.trim()} className="btn-primary">{saving ? "Saving..." : table ? "Update" : "Create"}</button>
          </PanelFooter>
        </form>
      </PanelCard>
    </SlideOver>
  );
}