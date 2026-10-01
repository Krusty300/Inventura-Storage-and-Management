import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Factory, Gauge, Pencil, Plus, Search, Trash2, TriangleAlert, Workflow } from "lucide-react";
import api from "../api/client";
import type { Location, Routing, WorkCenter, WorkCenterLoad } from "../types";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import PageHeader from "../components/PageHeader";
import StatCard, { KpiGrid } from "../components/StatCard";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import FittedSelect from "../components/FittedSelect";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";

const WORK_CENTER_TYPES = ["workstation", "machine", "labor", "outsourced"] as const;

const WORK_CENTER_TYPE_LABELS: Record<string, string> = {
  workstation: "Workstation",
  machine: "Machine",
  labor: "Labor",
  outsourced: "Outsourced",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Tab = "work-centers" | "routings";

function formatMinutes(minutes: number): string {
  const total = Math.max(Math.round(minutes), 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

export default function WorkCenters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const tabParam = searchParams.get("tab");
  const canRoutings = can("routings.view");
  const tab: Tab = tabParam === "routings" && canRoutings ? "routings" : "work-centers";

  const setTab = (next: Tab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "work-centers") params.delete("tab");
      else params.set("tab", next);
      return params;
    }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Factory}
        title="Work Centers"
        subtitle="Capacity, shifts, and the routings that route work through each center."
      />

      <div className="flex gap-1 bg-subtle p-1 rounded-lg w-fit flex-wrap">
        <button
          onClick={() => setTab("work-centers")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "work-centers" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          Work Centers
        </button>
        {canRoutings && (
          <button
            onClick={() => setTab("routings")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "routings" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            Routings
          </button>
        )}
      </div>

      {tab === "work-centers" ? <WorkCentersTab /> : <RoutingsTab />}
    </div>
  );
}

function WorkCentersTab() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WorkCenter | null>(null);
  const [deleting, setDeleting] = useState<WorkCenter | null>(null);

  const canCreate = can("work_centers.create");
  const canEdit = can("work_centers.update");
  const canDelete = can("work_centers.delete");

  const { data: centers, isLoading, isError } = useQuery({
    queryKey: ["work-centers", "all"],
    queryFn: async () => {
      const { data } = await api.get("/work-centers", { params: { limit: PAGE_SIZE_LOOKUP } });
      return data.items as WorkCenter[];
    },
  });

  const { data: load } = useQuery({
    queryKey: ["work-centers", "load"],
    queryFn: async () => {
      const { data } = await api.get("/work-centers/load");
      return data as WorkCenterLoad[];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ["locations", "all"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return data.items as Location[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/work-centers/${id}`),
    onSuccess: () => {
      addToast("Work center deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["work-centers"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete work center"), "error"),
  });

  const loadById = useMemo(() => {
    const map = new Map<number, WorkCenterLoad>();
    (load || []).forEach((entry) => map.set(entry.work_center_id, entry));
    return map;
  }, [load]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    return (centers || []).filter((c) => {
      if (typeFilter && c.work_center_type !== typeFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (WORK_CENTER_TYPE_LABELS[c.work_center_type] || "").toLowerCase().includes(q)
      );
    });
  }, [centers, q, typeFilter]);

  const totalSteps = (centers || []).reduce((sum, c) => sum + c.operation_count, 0);
  const activeCount = (centers || []).filter((c) => c.is_active).length;
  const bottleneckCount = (load || []).filter((l) => l.is_bottleneck).length;

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (center: WorkCenter) => { setEditing(center); setShowForm(true); };

  return (
    <div className="space-y-6">
      <KpiGrid columns={4}>
        <StatCard label="Work Centers" value={centers?.length ?? 0} icon={Factory} tone="primary" />
        <StatCard label="Active" value={activeCount} icon={Gauge} tone="emerald" />
        <StatCard label="Bottlenecks" value={bottleneckCount} icon={TriangleAlert} tone={bottleneckCount ? "red" : "default"} />
        <StatCard label="Routing Steps" value={totalSteps} icon={Workflow} tone="sky" />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="input pl-10"
            placeholder="Search by name, code, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search work centers"
          />
        </div>
        <div className="w-44">
          <FittedSelect
            ariaLabel="Filter by type"
            value={typeFilter}
            onChange={setTypeFilter}
            placeholder="All types"
            options={[
              { value: "", label: "All types" },
              ...WORK_CENTER_TYPES.map((t) => ({ value: t, label: WORK_CENTER_TYPE_LABELS[t] })),
            ]}
          />
        </div>
        {canCreate && (
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-1 ml-auto">
            <Plus size={16} /> Add Work Center
          </button>
        )}
      </div>

      {isLoading ? (
        <Skeleton variant="rows" rows={5} cols={4} />
      ) : isError ? (
        <ErrorState variant="block" onRetry={() => queryClient.invalidateQueries({ queryKey: ["work-centers"] })} />
      ) : visible.length === 0 ? (
        <EmptyState
          variant="block"
          icon={<Factory size={48} />}
          title={q || typeFilter ? "No matching work centers" : "No work centers yet"}
          message={
            q || typeFilter
              ? "Nothing matched the current filters."
              : "Add the machines, benches, and labor pools that production runs through."
          }
          actionLabel={q || typeFilter || !canCreate ? undefined : "Add Work Center"}
          onAction={q || typeFilter || !canCreate ? undefined : openCreate}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-app border-b border-border text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Work Center</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Location</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Shift</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Efficiency</th>
                  <th className="px-4 py-3 font-medium hidden xl:table-cell">Rate</th>
                  <th className="px-4 py-3 font-medium">Steps</th>
                  <th className="px-4 py-3 font-medium">7-day Load</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((center) => {
                  const report = loadById.get(center.id);
                  return (
                    <tr key={center.id} className="border-b border-border last:border-0 hover:bg-app">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${center.is_active ? "bg-emerald-500" : "bg-faint"}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="font-medium text-ink truncate">{center.name}</div>
                            <div className="text-xs text-muted font-mono">{center.code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge badge-neutral">{WORK_CENTER_TYPE_LABELS[center.work_center_type] ?? center.work_center_type}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted">
                        {center.location_name || <span className="text-faint">—</span>}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted whitespace-nowrap">
                        {center.shift_start} · {center.hours_per_day}h
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted">{center.efficiency}%</td>
                      <td className="px-4 py-3 hidden xl:table-cell text-muted">{formatCurrency(center.hourly_rate, currencySymbol)}/h</td>
                      <td className="px-4 py-3 text-muted">{center.operation_count}</td>
                      <td className="px-4 py-3">
                        {report ? (
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${report.is_bottleneck ? "text-red-600 dark:text-red-400" : "text-ink"}`}>
                              {report.utilization_pct}%
                            </span>
                            {report.is_bottleneck && <span className="badge bg-red-500/10 text-red-700 dark:text-red-300">Bottleneck</span>}
                            {report.overdue_work_orders > 0 && (
                              <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300" title="Overdue open work orders">
                                {report.overdue_work_orders} late
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {canEdit && (
                            <button onClick={() => openEdit(center)} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-primary" aria-label={`Edit ${center.name}`}>
                              <Pencil size={16} />
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => setDeleting(center)} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600" aria-label={`Delete ${center.name}`}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <WorkCenterFormModal
          center={editing}
          locations={locations || []}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["work-centers"] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Work Center"
        message={`Are you sure you want to delete "${deleting?.name}"? Work centers used by a routing cannot be deleted.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

interface WorkCenterForm {
  code: string;
  name: string;
  work_center_type: string;
  location_id: string;
  hours_per_day: string;
  shift_start: string;
  efficiency: string;
  hourly_rate: string;
  working_days: number[];
  notes: string;
  is_active: boolean;
}

function WorkCenterFormModal({ center, locations, onClose, onSaved }: {
  center: WorkCenter | null;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<WorkCenterForm>(() => ({
    code: center?.code ?? "",
    name: center?.name ?? "",
    work_center_type: center?.work_center_type ?? "workstation",
    location_id: center?.location_id != null ? String(center.location_id) : "",
    hours_per_day: String(center?.hours_per_day ?? 8),
    shift_start: center?.shift_start ?? "08:00",
    efficiency: String(center?.efficiency ?? 100),
    hourly_rate: String(center?.hourly_rate ?? 0),
    working_days: center?.working_day_list ?? [0, 1, 2, 3, 4],
    notes: center?.notes ?? "",
    is_active: center?.is_active ?? true,
  }));

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter((d) => d !== day)
        : [...prev.working_days, day].sort((a, b) => a - b),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      addToast("Name and code are required", "error");
      return;
    }
    const hours = Number(form.hours_per_day);
    const efficiency = Number(form.efficiency);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      addToast("Hours per day must be between 0 and 24", "error");
      return;
    }
    if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 1000) {
      addToast("Efficiency must be between 0 and 1000", "error");
      return;
    }
    setSaving(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      work_center_type: form.work_center_type,
      location_id: form.location_id ? Number(form.location_id) : null,
      hours_per_day: hours,
      shift_start: form.shift_start,
      efficiency,
      hourly_rate: Number(form.hourly_rate) || 0,
      working_days: form.working_days,
      notes: form.notes.trim(),
      is_active: form.is_active,
    };
    try {
      if (center) await api.put(`/work-centers/${center.id}`, payload);
      else await api.post("/work-centers", payload);
      addToast(center ? "Work center updated" : "Work center created", "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving work center"), "error");
    }
    setSaving(false);
  };

  const locationOptions = [
    { value: "", label: "No location" },
    ...locations
      .filter((l) => l.is_active || l.id === center?.location_id)
      .map((l) => ({ value: String(l.id), label: l.path })),
  ];

  return (
    <Modal open onClose={onClose} title={center ? "Edit Work Center" : "Add Work Center"} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CNC Mill 1" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Code *</label>
            <input className="input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CNC-1" required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Type</label>
            <FittedSelect
              ariaLabel="Work center type"
              value={form.work_center_type}
              onChange={(v) => setForm({ ...form, work_center_type: v })}
              options={WORK_CENTER_TYPES.map((t) => ({ value: t, label: WORK_CENTER_TYPE_LABELS[t] }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Location</label>
            <FittedSelect
              ariaLabel="Location"
              value={form.location_id}
              onChange={(v) => setForm({ ...form, location_id: v })}
              options={locationOptions}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Hours / day</label>
              <input type="number" min="0" max="24" step="0.5" className="input" value={form.hours_per_day} onChange={(e) => setForm({ ...form, hours_per_day: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Shift start</label>
              <input type="time" className="input" value={form.shift_start} onChange={(e) => setForm({ ...form, shift_start: e.target.value })} aria-label="Shift start" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Efficiency %</label>
              <input type="number" min="1" max="1000" step="1" className="input" value={form.efficiency} onChange={(e) => setForm({ ...form, efficiency: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Rate / hour</label>
              <input type="number" min="0" step="0.01" className="input" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} />
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-ink mb-2">Working days</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, day) => {
                const on = form.working_days.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(day)}
                    aria-pressed={on}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      on
                        ? "border-primary bg-primary-soft text-primary-strong dark:text-primary"
                        : "border-border text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted mt-2">Capacity is only counted on these days.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink px-1">
          <input
            type="checkbox"
            className="rounded border-border-strong accent-primary"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
          <span className="text-xs text-muted font-normal">Inactive centers are hidden from routing choices.</span>
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : center ? "Update Work Center" : "Create Work Center"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RoutingsTab() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Routing | null>(null);
  const canEdit = can("routings.update");

  const { data: routings, isLoading, isError } = useQuery({
    queryKey: ["routings", "products"],
    queryFn: async () => {
      const { data } = await api.get("/routings/products");
      return data as Routing[];
    },
  });

  const { data: centers } = useQuery({
    queryKey: ["work-centers", "all"],
    queryFn: async () => {
      const { data } = await api.get("/work-centers", { params: { limit: PAGE_SIZE_LOOKUP } });
      return data.items as WorkCenter[];
    },
  });

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return routings || [];
    return (routings || []).filter(
      (r) => r.product_name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
    );
  }, [routings, q]);

  const withRouting = (routings || []).filter((r) => r.operation_count > 0).length;

  return (
    <div className="space-y-6">
      <KpiGrid columns={3}>
        <StatCard label="Products" value={routings?.length ?? 0} icon={Factory} tone="primary" />
        <StatCard label="With a Routing" value={withRouting} icon={Workflow} tone="emerald" />
        <StatCard label="Steps Defined" value={(routings || []).reduce((sum, r) => sum + r.operation_count, 0)} icon={Gauge} tone="sky" />
      </KpiGrid>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          className="input pl-10"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search routings"
        />
      </div>

      {isLoading ? (
        <Skeleton variant="rows" rows={5} cols={4} />
      ) : isError ? (
        <ErrorState variant="block" onRetry={() => queryClient.invalidateQueries({ queryKey: ["routings"] })} />
      ) : visible.length === 0 ? (
        <EmptyState
          variant="block"
          icon={<Workflow size={48} />}
          title={q ? "No matching products" : "No manufactured products"}
          message={q ? `Nothing matched "${search}".` : "Products you can build will show here so you can lay out their steps."}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-app border-b border-border text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Steps</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Centers</th>
                  <th className="px-4 py-3 font-medium">Ideal / unit</th>
                  <th className="px-4 py-3 font-medium">Real / unit</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((routing) => (
                  <tr key={routing.product_id} className="border-b border-border last:border-0 hover:bg-app">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink truncate">{routing.product_name}</div>
                      <div className="text-xs text-muted font-mono">{routing.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{routing.operation_count}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted">{routing.unique_work_centers}</td>
                    <td className="px-4 py-3 text-muted">{formatMinutes(routing.ideal_minutes_per_unit)}</td>
                    <td className="px-4 py-3 text-muted">{formatMinutes(routing.adjusted_minutes_per_unit)}</td>
                    <td className="px-4 py-3">
                      {routing.operation_count === 0 ? (
                        <span className="badge badge-neutral">No routing</span>
                      ) : routing.is_complete ? (
                        <span className="badge bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Ready</span>
                      ) : (
                        <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300">Has gaps</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => setSelected(routing)}
                          className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1"
                          aria-label={`${routing.operation_count ? "Edit" : "Add"} routing for ${routing.product_name}`}
                        >
                          <Pencil size={14} /> {canEdit ? (routing.operation_count ? "Edit" : "Add") : "View"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <RoutingEditorModal
          routing={selected}
          centers={centers || []}
          readOnly={!canEdit}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            queryClient.invalidateQueries({ queryKey: ["routings"] });
            queryClient.invalidateQueries({ queryKey: ["work-centers"] });
          }}
        />
      )}
    </div>
  );
}

interface OpDraft {
  key: string;
  work_center_id: string;
  name: string;
  setup_minutes: string;
  run_minutes_per_unit: string;
  notes: string;
}

let opKey = 0;
function makeOpKey(): string {
  opKey += 1;
  return `op-${opKey}`;
}

function RoutingEditorModal({ routing, centers, readOnly, onClose, onSaved }: {
  routing: Routing;
  centers: WorkCenter[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [ops, setOps] = useState<OpDraft[]>(() =>
    routing.operations.map((op) => ({
      key: makeOpKey(),
      work_center_id: String(op.work_center_id),
      name: op.name,
      setup_minutes: String(op.setup_minutes),
      run_minutes_per_unit: String(op.run_minutes_per_unit),
      notes: op.notes,
    })),
  );

  const usableCenters = centers.filter((c) => c.is_active || ops.some((o) => o.work_center_id === String(c.id)));
  const centerOptions = usableCenters.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }));
  const efficiencyById = useMemo(() => {
    const map = new Map<number, number>();
    centers.forEach((c) => map.set(c.id, c.efficiency > 0 ? c.efficiency : 100));
    return map;
  }, [centers]);

  const idealTotal = ops.reduce((sum, o) => sum + (Number(o.setup_minutes) || 0) + (Number(o.run_minutes_per_unit) || 0), 0);
  const adjustedTotal = ops.reduce((sum, o) => {
    const base = (Number(o.setup_minutes) || 0) + (Number(o.run_minutes_per_unit) || 0);
    const eff = efficiencyById.get(Number(o.work_center_id)) ?? 100;
    return sum + base * (100 / eff);
  }, 0);

  const update = (key: string, patch: Partial<OpDraft>) => {
    setOps((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  };

  const move = (index: number, delta: number) => {
    setOps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addStep = () => {
    const fallback = usableCenters[0];
    setOps((prev) => [
      ...prev,
      {
        key: makeOpKey(),
        work_center_id: fallback ? String(fallback.id) : "",
        name: "",
        setup_minutes: "0",
        run_minutes_per_unit: "0",
        notes: "",
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ops.some((o) => !o.work_center_id)) {
      addToast("Every step needs a work center", "error");
      return;
    }
    if (ops.some((o) => (Number(o.setup_minutes) || 0) < 0 || (Number(o.run_minutes_per_unit) || 0) < 0)) {
      addToast("Step times cannot be negative", "error");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/routings/products/${routing.product_id}`, {
        operations: ops.map((o, index) => ({
          work_center_id: Number(o.work_center_id),
          position: index,
          name: o.name.trim(),
          setup_minutes: Number(o.setup_minutes) || 0,
          run_minutes_per_unit: Number(o.run_minutes_per_unit) || 0,
          notes: o.notes.trim(),
          is_active: true,
        })),
      });
      addToast("Routing saved", "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving routing"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Routing — ${routing.product_name}`} xwide>
      <form onSubmit={handleSubmit} className="space-y-5">
        {ops.length === 0 ? (
          <EmptyState
            compact
            icon={<Workflow size={32} />}
            title="No steps yet"
            message={usableCenters.length === 0 ? "Add an active work center before laying out a route." : "Add the first step to build this route."}
            actionLabel={readOnly || usableCenters.length === 0 ? undefined : "Add Step"}
            onAction={readOnly || usableCenters.length === 0 ? undefined : addStep}
          />
        ) : (
          <div className="space-y-3">
            {ops.map((op, index) => (
              <div key={op.key} className="rounded-xl border border-border bg-app p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary-soft text-primary-strong dark:text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-ink">Step {index + 1}</span>
                  {!readOnly && (
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-primary disabled:opacity-30" aria-label={`Move step ${index + 1} up`}>
                        <ArrowUp size={16} />
                      </button>
                      <button type="button" onClick={() => move(index, 1)} disabled={index === ops.length - 1} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-primary disabled:opacity-30" aria-label={`Move step ${index + 1} down`}>
                        <ArrowDown size={16} />
                      </button>
                      <button type="button" onClick={() => setOps((prev) => prev.filter((o) => o.key !== op.key))} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600" aria-label={`Remove step ${index + 1}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">Work center</label>
                    <FittedSelect
                      ariaLabel={`Step ${index + 1} work center`}
                      value={op.work_center_id}
                      onChange={(v) => update(op.key, { work_center_id: v })}
                      options={centerOptions}
                      disabled={readOnly}
                      placeholder="Select center"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Step name</label>
                    <input className="input" value={op.name} onChange={(e) => update(op.key, { name: e.target.value })} placeholder="e.g. Cut, Weld, Paint" disabled={readOnly} aria-label={`Step ${index + 1} name`} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">Setup minutes</label>
                    <input type="number" min="0" className="input" value={op.setup_minutes} onChange={(e) => update(op.key, { setup_minutes: e.target.value })} disabled={readOnly} aria-label={`Step ${index + 1} setup minutes`} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Run minutes / unit</label>
                    <input type="number" min="0" step="0.01" className="input" value={op.run_minutes_per_unit} onChange={(e) => update(op.key, { run_minutes_per_unit: e.target.value })} disabled={readOnly} aria-label={`Step ${index + 1} run minutes per unit`} />
                  </div>
                </div>
              </div>
            ))}
            {!readOnly && usableCenters.length > 0 && (
              <button type="button" onClick={addStep} className="btn-secondary inline-flex items-center gap-1">
                <Plus size={16} /> Add Step
              </button>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-app p-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted">Ideal minutes / unit</p>
            <p className="font-semibold text-ink">{formatMinutes(idealTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Real minutes / unit (efficiency adjusted)</p>
            <p className="font-semibold text-ink">{formatMinutes(adjustedTotal)}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && (
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Save Routing"}</button>
          )}
        </div>
      </form>
    </Modal>
  );
}
