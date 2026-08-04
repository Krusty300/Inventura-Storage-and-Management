import { useEffect, useState } from "react";
import { Eye, PackagePlus, FileText, ArrowLeftRight, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { LPN, Location, PaginatedResponse } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 25;

export default function LPNs() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<LPN | null>(null);
  const [moving, setMoving] = useState<LPN | null>(null);
  const [deleting, setDeleting] = useState<LPN | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/lpns/${id}`),
    onSuccess: () => {
      addToast("LPN deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["lpns"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Cannot delete LPN", "error"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["lpns", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/lpns", { params });
      return data as PaginatedResponse<LPN>;
    },
  });

  const lpns = data?.items || [];

  const printLabel = (id: number) => {
    api.get(`/labels/pallet/${id}`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">LPNs (Pallets & Totes)</h1>
        {can("lpns.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <PackagePlus size={16} className="inline mr-1" />Create LPN
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by LPN number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search LPNs" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="LPNs table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3 font-medium text-muted">LPN #</th>
              <th className="px-4 py-3 font-medium text-muted">Type</th>
              <th className="px-4 py-3 font-medium text-muted">Location</th>
              <th className="px-4 py-3 font-medium text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-muted">Items</th>
              <th className="px-4 py-3 font-medium text-muted">Qty</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : lpns.length === 0 ? (
              <EmptyState title="No LPNs yet" message="Create LPNs to track pallets and totes through the warehouse." actionLabel="Create LPN" onAction={() => setShowForm(true)} />
            ) : lpns.map((l) => (
              <tr key={l.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{l.lpn_number}</td>
                <td className="px-4 py-3 text-muted capitalize">{l.lpn_type}</td>
                <td className="px-4 py-3 text-muted">{l.location_name || "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${l.status === "active" ? "badge-success" : "badge-info"}`}>{l.status}</span></td>
                <td className="px-4 py-3">{l.content_count}</td>
                <td className="px-4 py-3">{l.total_quantity}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(l)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${l.lpn_number}`}><Eye size={16} /></button>
                    <button onClick={() => printLabel(l.id)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print label ${l.lpn_number}`}><FileText size={16} /></button>
                    {can("lpns.update") && (
                      <button onClick={() => setMoving(l)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Move ${l.lpn_number}`}><ArrowLeftRight size={16} /></button>
                    )}
                    {can("lpns.delete") && (
                      <button onClick={() => setDeleting(l)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${l.lpn_number}`}><Trash2 size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {showForm && (
        <LpnCreateModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["lpns"] }); }}
        />
      )}

      {viewing && <LpnDetail lpn={viewing} onClose={() => setViewing(null)} />}

      {moving && (
        <LpnMoveModal
          lpn={moving}
          onClose={() => setMoving(null)}
          onSaved={() => { setMoving(null); queryClient.invalidateQueries({ queryKey: ["lpns"] }); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete LPN"
        message={`Are you sure you want to delete "${deleting?.lpn_number}"? Only LPNs with no contents can be deleted.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function LpnCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [lpn_number, setLpnNumber] = useState("");
  const [lpn_type, setLpnType] = useState("pallet");
  const [location_id, setLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/lpns", {
        lpn_number: lpn_number.trim() || null,
        lpn_type,
        location_id: location_id ? Number(location_id) : null,
      });
      addToast(`LPN ${data.lpn_number} created`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error creating LPN", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="Create LPN">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">LPN Number</label>
          <input className="input" value={lpn_number} onChange={(e) => setLpnNumber(e.target.value)} placeholder="Leave blank to auto-generate" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Type</label>
            <select className="select" value={lpn_type} onChange={(e) => setLpnType(e.target.value)}>
              <option value="pallet">Pallet</option>
              <option value="tote">Tote</option>
              <option value="carton">Carton</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Location</label>
            <select className="select" value={location_id} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">None</option>
              {locations.filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path)).map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Creating..." : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}

function LpnDetail({ lpn, onClose }: { lpn: LPN; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`LPN ${lpn.lpn_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted">Type</p>
            <p className="font-medium capitalize">{lpn.lpn_type}</p>
          </div>
          <div>
            <p className="text-muted">Location</p>
            <p className="font-medium">{lpn.location_name || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p className="font-medium capitalize">{lpn.status}</p>
          </div>
        </div>
        {lpn.contents.length === 0 ? (
          <p className="text-sm text-muted">This LPN has no contents yet. Receive stock into it via a receipt or move stock to it.</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-2 font-medium text-muted">Product</th>
                  <th className="px-4 py-2 font-medium text-muted">Lot</th>
                  <th className="px-4 py-2 font-medium text-muted">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lpn.contents.map((c, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium">{c.product_name}</td>
                    <td className="px-4 py-2 text-muted">{c.lot_number || "—"}</td>
                    <td className="px-4 py-2">{c.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function LpnMoveModal({ lpn, onClose, onSaved }: { lpn: LPN; onClose: () => void; onSaved: () => void }) {
  const [to_location_id, setToLocationId] = useState("");
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data: locations } = useQuery({
    queryKey: ["locations", "lpn-move"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return data.items as Location[];
    },
  });

  const moveMutation = useMutation({
    mutationFn: () => api.post(`/lpns/${lpn.id}/move?to_location_id=${Number(to_location_id)}`),
    onSuccess: () => {
      addToast(`LPN ${lpn.lpn_number} moved`, "success");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onSaved();
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Move failed", "error"),
  });

  return (
    <Modal open onClose={onClose} title={`Move ${lpn.lpn_number}`}>
      <form onSubmit={(e) => { e.preventDefault(); moveMutation.mutate(); }} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Current location</label>
          <div className="input bg-app">{lpn.location_name || "—"}</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Move to *</label>
          <select className="select" value={to_location_id} onChange={(e) => setToLocationId(e.target.value)} required>
            <option value="">Select...</option>
            {(locations || []).filter((l) => l.is_active && l.id !== lpn.location_id).sort((a, b) => a.path.localeCompare(b.path)).map((l) => (
              <option key={l.id} value={l.id}>{l.path}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted">Stock lines, serial numbers, and the LPN location are updated together.</p>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={moveMutation.isPending} className="btn-primary">{moveMutation.isPending ? "Moving..." : "Move LPN"}</button>
        </div>
      </form>
    </Modal>
  );
}
