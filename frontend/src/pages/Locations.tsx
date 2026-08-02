import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, MapPin, Pencil, Trash2, Package, Eye, FolderOpen, Folder } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Location, LocationTree } from "../types";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import LocationDetail from "../components/LocationDetail";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { exportCSV } from "../utils/csv";

interface LocationForm {
  name: string;
  code: string;
  location_type: string;
  parent_id: string;
  is_active: boolean;
}

interface LocationSummary {
  total: number;
  active: number;
  inactive: number;
  total_stock_lines: number;
  total_lpns: number;
  total_quantity: number;
  total_value: number;
}

export default function Locations() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const [viewing, setViewing] = useState<Location | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const q = search.trim().toLowerCase();

  const { data: tree, isLoading } = useQuery({
    queryKey: ["locations", "tree"],
    queryFn: async () => {
      const { data } = await api.get("/locations/tree");
      return data as LocationTree[];
    },
  });

  const { data: all } = useQuery({
    queryKey: ["locations", "all"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return data.items as Location[];
    },
  });

  const { data: summary } = useQuery({
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
    onError: (err: any) => addToast(err.response?.data?.detail || "Cannot delete location", "error"),
  });

  const matches = (n: LocationTree) =>
    n.name.toLowerCase().includes(q) ||
    (n.code || "").toLowerCase().includes(q) ||
    n.location_type.toLowerCase().includes(q);

  const filterTree = (nodes: LocationTree[]): LocationTree[] =>
    nodes
      .filter((n) => matches(n) || filterTree(n.children || []).length > 0)
      .map((n) => ({ ...n, children: filterTree(n.children || []) }));

  const visibleTree = q ? filterTree(tree || []) : tree || [];
  const isSearching = q.length > 0;

  const allIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (nodes: LocationTree[]) => (nodes || []).forEach((n) => { ids.push(n.id); walk(n.children || []); });
    walk(tree || []);
    return ids;
  }, [tree]);

  const toggle = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const expandAll = () => setExpanded(new Set(allIds));
  const collapseAll = () => setExpanded(new Set());

  const handleExport = () => {
    exportCSV(
      ["Name", "Path", "Code", "Type", "Status", "Stock Lines", "Quantity", "Stock Value", "LPNs"],
      (all || []).map((l) => [
        l.name,
        l.path,
        l.code || "",
        l.location_type,
        l.is_active ? "active" : "inactive",
        l.stock_line_count,
        l.total_quantity,
        formatCurrency(l.stock_value, currencySymbol),
        l.lpn_count,
      ]),
      "locations"
    );
    addToast("Locations exported to CSV", "success");
  };

  const renderNode = (node: LocationTree, depth: number, forceOpen: boolean) => {
    const hasChildren = (node.children?.length || 0) > 0;
    const isOpen = forceOpen || expanded.has(node.id);
    const canEdit = can("locations.update");
    const canDelete = can("locations.delete");
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 border-b border-gray-100"
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
        >
          <button
            onClick={() => toggle(node.id)}
            disabled={!hasChildren}
            className="text-gray-400 disabled:opacity-30"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {hasChildren ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="inline-block w-4" />}
          </button>
          <MapPin size={16} className={node.is_active ? "text-indigo-500" : "text-gray-300"} />
          <span className="font-medium text-gray-800">{node.path}</span>
          <span className="text-xs text-gray-400 capitalize">{node.location_type}</span>
          {!node.is_active && <span className="text-xs text-gray-400">(inactive)</span>}
          <span className="ml-auto flex items-center gap-3 text-xs text-gray-500" aria-label={`${node.path} stats`}>
            <span className="flex items-center gap-1"><Package size={12} />{node.stock_line_count} lines</span>
            <span>{node.total_quantity} units</span>
            <span>{formatCurrency(node.stock_value, currencySymbol)}</span>
            <span>{node.lpn_count} LPNs</span>
          </span>
          <div className="flex gap-1">
            <button onClick={() => setViewing(node)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View ${node.path}`}>
              <Eye size={14} />
            </button>
            {canEdit && (
              <button onClick={() => { setEditing(node); setShowForm(true); }} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`Edit ${node.path}`}>
                <Pencil size={14} />
              </button>
            )}
            {canDelete && (
              <button onClick={() => setDeleting(node)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Delete ${node.path}`}>
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
    { label: "Total Locations", value: summary?.total ?? 0 },
    { label: "Active", value: summary?.active ?? 0 },
    { label: "Inactive", value: summary?.inactive ?? 0 },
    { label: "Stock Lines", value: summary?.total_stock_lines ?? 0 },
    { label: "LPNs", value: summary?.total_lpns ?? 0 },
    { label: "Stock Value", value: formatCurrency(summary?.total_value ?? 0, currencySymbol, 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary inline-flex items-center gap-1" aria-label="Export locations to CSV">
            Export
          </button>
          {can("locations.create") && (
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
              Add Location
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="card">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-md">
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
        <Skeleton rows={5} cols={3} />
      ) : visibleTree.length === 0 ? (
        <EmptyState
          title={q ? "No matching locations" : "No locations yet"}
          message={q ? `Nothing matched "${search}".` : "Create zones, aisles, and bins to organize your warehouse."}
          actionLabel={q ? undefined : "Add Location"}
          onAction={q ? undefined : () => { setEditing(null); setShowForm(true); }}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="px-4 py-3 bg-gray-50 border-b text-sm text-gray-600">Warehouse tree</div>
          {visibleTree.map((node) => renderNode(node, 0, isSearching))}
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

      {viewing && <LocationDetail location={viewing} onClose={() => setViewing(null)} />}

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
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving location", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={location ? "Edit Location" : "Add Location"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aisle A, Bin A-01" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. A-01" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select className="select" value={form.location_type} onChange={(e) => setForm({ ...form, location_type: e.target.value })}>
              <option value="bin">Bin</option>
              <option value="zone">Zone</option>
              <option value="aisle">Aisle</option>
              <option value="shelf">Shelf</option>
              <option value="storage">Storage</option>
              <option value="receiving">Receiving</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Parent</label>
          <select className="select" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
            <option value="">(Root)</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="rounded border-gray-300"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : location ? "Update" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
