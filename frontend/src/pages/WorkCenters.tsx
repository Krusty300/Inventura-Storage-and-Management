import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Factory, Gauge, Pencil, Plus, Search, Trash2, TriangleAlert, Workflow } from "lucide-react";
import api from "../api/client";
import type { Location, Routing, WorkCenter, WorkCenterLoad } from "../types";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import PageHeader from "../components/PageHeader";
import StatCard, { KpiGrid } from "../components/StatCard";
import WorkCenterDetail from "../components/WorkCenterDetail";
import WorkCenterForm from "../components/WorkCenterForm";
import RoutingEditor from "../components/RoutingEditor";
import ConfirmDialog from "../components/ConfirmDialog";
import FittedSelect from "../components/FittedSelect";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { WORK_CENTER_TYPES, WORK_CENTER_TYPE_LABELS, formatMinutes } from "../utils/workCenters";
import { errorMessage } from "../utils/errors";

type Tab = "work-centers" | "routings";

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
  const [viewing, setViewing] = useState<WorkCenter | null>(null);
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
                    <tr
                      key={center.id}
                      className="border-b border-border last:border-0 hover:bg-app cursor-pointer"
                      onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest("button") || t.closest("input") || t instanceof HTMLInputElement || t instanceof HTMLButtonElement) return;
                        setViewing(center);
                      }}
                    >
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
                          <button onClick={() => setViewing(center)} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-primary" aria-label={`View ${center.name}`}>
                            <Eye size={16} />
                          </button>
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
        <WorkCenterForm
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

      {viewing && (
        <WorkCenterDetail
          center={viewing}
          report={loadById.get(viewing.id)}
          onClose={() => setViewing(null)}
          onEdit={canEdit ? () => { setEditing(viewing); setViewing(null); setShowForm(true); } : undefined}
          onDelete={canDelete ? () => { setDeleting(viewing); setViewing(null); } : undefined}
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
        <RoutingEditor
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