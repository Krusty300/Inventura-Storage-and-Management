import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, ChevronDown, MapPin, Pencil, Trash2, Package, Eye, FolderOpen, Folder, FileText, Search, CheckCircle2, CircleOff, Layers, Boxes, Fingerprint, DollarSign, FolderTree } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, LOCATION_TYPES, LOCATION_TYPE_LABELS } from "../utils/constants";
import type { LocationType } from "../utils/constants";
import type { Location, LocationTree } from "../types";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import LocationDetail from "../components/LocationDetail";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { useExportCsv } from "../hooks/useExportCsv";
import { formatCurrency } from "../utils/currency";
import { errorMessage } from "../utils/errors";

interface LocationForm {
  name: string;
  code: string;
  location_type: LocationType;
  parent_id: string;
  is_active: boolean;
}

interface LocationSummary {
  total: number;
  active: number;
  inactive: number;
  total_stock_lines: number;
  total_lpns: number;
  total_lots: number;
  total_quantity: number;
  total_value: number;
  total_serials: number;
}

export default function Locations() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const q = search.trim().toLowerCase();
  const { exportCsv } = useExportCsv();

  const canEdit = can("locations.update");
  const canDelete = can("locations.delete");

  const { data: tree, isLoading, isError } = useQuery({
    queryKey: ["locations", "tree"],
    queryFn: async () => {
      const { data } = await api.get("/locations/tree");
      return data as LocationTree[];
    },
  });

  const { data: all } = useQuery({
    queryKey: ["locations", "all"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return data.items as Location[];
    },
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["locations", "summary"],
    queryFn: async () => {
      const { data } = await api.get("/locations/summary");
      return data as LocationSummary;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/locations/${id}`),
    onSuccess: () => {
      addToast("Location deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete location"), "error"),
  });

  const viewing = useMemo(() => {
    const locParam = searchParams.get("location");
    if (!locParam) return null;
    const id = Number(locParam);
    if (!Number.isInteger(id)) return null;
    return (all || []).find((l) => l.id === id) ?? null;
  }, [all, searchParams]);

  const openDetail = (loc: Location) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("location", String(loc.id));
      return next;
    }, { replace: true });
  };

  const printLabel = async (id: number) => {
    try {
      const { data } = await api.get(`/labels/location/${id}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to print label"), "error");
    }
  };

  const closeDetail = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("location");
      return next;
    }, { replace: true });
  };

  const matches = useCallback((n: LocationTree) => {
    const label = LOCATION_TYPE_LABELS[n.location_type]?.toLowerCase() ?? "";
    return (
      n.name.toLowerCase().includes(q) ||
      (n.code || "").toLowerCase().includes(q) ||
      n.location_type.toLowerCase().includes(q) ||
      label.includes(q)
    );
  }, [q]);

  const visibleTree = useMemo(() => {
    if (!q) return tree || [];
    const filterTree = (nodes: LocationTree[]): LocationTree[] =>
      nodes.reduce<LocationTree[]>((acc, n) => {
        const kids = filterTree(n.children || []);
        if (matches(n) || kids.length > 0) acc.push({ ...n, children: kids });
        return acc;
      }, []);
    return filterTree(tree || []);
  }, [tree, q, matches]);

  const isSearching = q.length > 0;

  const allIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (nodes: LocationTree[]) => (nodes || []).forEach((n) => { ids.push(n.id); walk(n.children || []); });
    walk(tree || []);
    return ids;
  }, [tree]);

  const toggle = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => setExpanded(new Set(allIds));
  const collapseAll = () => setExpanded(new Set());

  const handleExport = () => {
    exportCsv("/reports/export/locations", "locations_report.csv", "Locations", search.trim() ? { search: search.trim() } : undefined);
  };

  const renderNode = (node: LocationTree, depth: number, forceOpen: boolean) => {
    const hasChildren = (node.children?.length || 0) > 0;
    const isOpen = forceOpen || expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="group flex items-center gap-2 px-3 py-2.5 hover:bg-app border-b border-border"
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
          role="treeitem"
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-label={`${node.path} — ${LOCATION_TYPE_LABELS[node.location_type]}${node.is_active ? "" : ", inactive"}`}
        >
          <button
            onClick={() => toggle(node.id)}
            disabled={!hasChildren}
            className="text-faint disabled:opacity-30"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {hasChildren ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="inline-block w-4" />}
          </button>
          <MapPin size={16} className={node.is_active ? "text-indigo-500" : "text-faint"} />
          <span className="font-medium text-ink truncate">{node.path}</span>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full capitalize ${TYPE_BADGE[node.location_type] ?? "badge-neutral"}`}>{LOCATION_TYPE_LABELS[node.location_type]}</span>
          {!node.is_active && <span className="badge badge-neutral shrink-0">Inactive</span>}
          <span className="ml-auto hidden md:flex items-center gap-3 text-xs text-muted shrink-0" aria-label={`${node.path} stats`}>
            <span className="flex items-center gap-1 whitespace-nowrap"><Package size={12} />{node.stock_line_count} lines</span>
            <span className="whitespace-nowrap">{node.total_quantity} units</span>
            <span className="whitespace-nowrap">{formatCurrency(node.stock_value, currencySymbol)}</span>
            <span className="whitespace-nowrap">{node.lpn_count} LPNs</span>
            <span className="whitespace-nowrap">{node.lot_count} lots</span>
          </span>
          <div className="ml-auto md:ml-0 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button onClick={() => printLabel(node.id)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print label ${node.path}`}>
              <FileText size={14} />
            </button>
            <button onClick={() => openDetail(node)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${node.path}`}>
              <Eye size={14} />
            </button>
            {canEdit && (
              <button onClick={() => { setEditing(node); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${node.path}`}>
                <Pencil size={14} />
              </button>
            )}
            {canDelete && (
              <button onClick={() => setDeleting(node)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${node.path}`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        {isOpen && hasChildren && (node.children || []).map((child) => renderNode(child, depth + 1, forceOpen))}
      </div>
    );
  };

  const summaryCards = [
    { label: "Total Locations", value: summary?.total ?? 0, icon: <MapPin size={18} />, theme: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" },
    { label: "Active", value: summary?.active ?? 0, icon: <CheckCircle2 size={18} />, theme: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { label: "Inactive", value: summary?.inactive ?? 0, icon: <CircleOff size={18} />, theme: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
    { label: "Stock Lines", value: summary?.total_stock_lines ?? 0, icon: <Layers size={18} />, theme: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" },
    { label: "LPNs", value: summary?.total_lpns ?? 0, icon: <Package size={18} />, theme: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" },
    { label: "Lots", value: summary?.total_lots ?? 0, icon: <Boxes size={18} />, theme: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
    { label: "Serialized Units", value: summary?.total_serials ?? 0, icon: <Fingerprint size={18} />, theme: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300" },
    { label: "Stock Value", value: formatCurrency(summary?.total_value ?? 0, currencySymbol, 0), icon: <DollarSign size={18} />, theme: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Locations</h1>
          <p className="text-sm text-muted mt-1">Organize your warehouse into zones, aisles, shelves, and bins.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleExport} className="btn-secondary inline-flex items-center gap-1" aria-label="Export locations to CSV">
            Download CSV
          </button>
          {can("locations.create") && (
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary inline-flex items-center gap-1">
              <Package size={16} /> Add Location
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {summaryLoading
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="card" rows={1} />)
          : summaryCards.map((card) => (
            <div key={card.label} className="card flex items-center gap-3 py-4 min-w-0 hover:shadow-md hover:-translate-y-px transition-[box-shadow,transform]">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.theme}`}>{card.icon}</span>
              <div className="min-w-0">
                <p className="text-[13px] text-muted truncate">{card.label}</p>
                <p className="text-xl font-bold text-ink truncate">{card.value}</p>
              </div>
            </div>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="input pl-10"
            placeholder="Search by name, code, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search locations"
          />
        </div>
        <button onClick={expandAll} className="btn-secondary inline-flex items-center gap-1 text-sm" aria-label="Expand all locations">
          <FolderOpen size={14} /> Expand all
        </button>
        <button onClick={collapseAll} className="btn-secondary inline-flex items-center gap-1 text-sm" aria-label="Collapse all locations">
          <Folder size={14} /> Collapse all
        </button>
      </div>

      {isLoading ? (
        <Skeleton variant="rows" rows={5} cols={3} />
      ) : isError ? (
        <ErrorState variant="block" onRetry={() => queryClient.invalidateQueries({ queryKey: ["locations"] })} />
      ) : visibleTree.length === 0 ? (
        <EmptyState
          variant="block"
          title={q ? "No matching locations" : "No locations yet"}
          message={q ? `Nothing matched "${search}".` : "Create zones, aisles, and bins to organize your warehouse."}
          actionLabel={q ? undefined : "Add Location"}
          onAction={q ? undefined : () => { setEditing(null); setShowForm(true); }}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="flex items-center gap-2 px-4 py-3 bg-app border-b text-sm text-muted">
              <FolderTree size={16} className="text-indigo-500" />
              <span className="font-medium text-ink">Warehouse tree</span>
              <span className="text-xs text-faint">— {visibleTree.length} top-level {visibleTree.length === 1 ? "location" : "locations"}</span>
            </div>
            <div role="tree" aria-label="Warehouse location tree">
              {visibleTree.map((node) => renderNode(node, 0, isSearching))}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <LocationFormModal
          location={editing}
          locations={all || []}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["locations"] }); }}
        />
      )}

      {viewing && <LocationDetail location={viewing} onClose={closeDetail} />}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Location"
        message={`Are you sure you want to delete "${deleting?.path}"? Locations with children, stock, or LPNs cannot be deleted.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

const TYPE_BADGE: Record<LocationType, string> = {
  zone: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  aisle: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  shelf: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bin: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  storage: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  receiving: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  shipping: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  wip: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  quarantine: "bg-red-500/10 text-red-700 dark:text-red-300",
};

function LocationFormModal({ location, locations, onClose, onSaved }: {
  location: Location | null;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LocationForm>({
    name: location?.name || "",
    code: location?.code || "",
    location_type: location?.location_type || "bin",
    parent_id: location?.parent_id?.toString() || "",
    is_active: location?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const parents = locations
    .filter((l) => l.id !== location?.id && (l.is_active || location?.is_active === false))
    .sort((a, b) => a.path.localeCompare(b.path));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      addToast("Name is required", "error");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      location_type: form.location_type,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      is_active: form.is_active,
    };
    try {
      if (location) await api.put(`/locations/${location.id}`, payload);
      else await api.post("/locations", payload);
      addToast(location ? "Location updated" : "Location created", "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving location"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={location ? "Edit Location" : "Add Location"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aisle A, Bin A-01" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Code</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. A-01" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Type</label>
              <select className="select" value={form.location_type} onChange={(e) => setForm({ ...form, location_type: e.target.value as LocationType })}>
                {LOCATION_TYPES.map((t) => (
                  <option key={t} value={t}>{LOCATION_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Parent</label>
            <select className="select" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
              <option value="">(Root)</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
            </select>
          </div>
        </div>
        <div className="px-1 py-2 border-t border-border" />
        <label className="flex items-center gap-2 text-sm text-ink px-1">
          <input
            type="checkbox"
            className="rounded border-border-strong accent-indigo-600"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
          <span className="text-xs text-muted font-normal">Inactive locations are hidden from picker options.</span>
        </label>
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : location ? "Update Location" : "Create Location"}</button>
        </div>
      </form>
    </Modal>
  );
}
