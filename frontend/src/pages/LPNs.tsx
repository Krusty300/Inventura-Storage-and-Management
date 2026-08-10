import { useEffect, useState } from "react";
import { Eye, FileText, ArrowLeftRight, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { LPN, Location, LPNSerialItem, PaginatedResponse, SerialNumber, StockLocation, StockMovement } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useDateFormat } from "../hooks/useDateFormat";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";

import { usePageSize } from "../hooks/usePageSize";

export default function LPNs() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
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
            Create LPN
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by LPN number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search LPNs" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
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
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"load" | "unload" | "activity" | null>(null);

  const { data: live } = useQuery({
    queryKey: ["lpn", lpn.id],
    queryFn: async () => {
      const { data } = await api.get(`/lpns/${lpn.id}`);
      return data as LPN;
    },
    initialData: lpn,
  });

  const current = live || lpn;
  const contents = current.contents || [];
  const serials = current.serials || [];
  const hasContents = contents.length > 0 || serials.length > 0;

  function statusBadge(status: string) {
    switch (status) {
      case "in_stock": return "badge-success";
      case "reserved": return "badge-info";
      case "sold": return "badge-neutral";
      case "quarantined": return "badge-warning";
      case "inactive": return "badge-neutral";
      case "scrapped": return "badge-danger";
      default: return "";
    }
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["lpn", lpn.id] });
    queryClient.invalidateQueries({ queryKey: ["lpn", lpn.id, "movements"] });
    queryClient.invalidateQueries({ queryKey: ["lpns"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setAction(null);
  };

  return (
    <Modal open onClose={onClose} title={`LPN ${current.lpn_number}`} wide>
      {action === "activity" ? (
        <LpnActivity lpnId={current.id} onClose={() => setAction(null)} />
      ) : action ? (
        <LpnStockModal
          lpn={current}
          mode={action}
          onClose={() => setAction(null)}
          onSaved={refresh}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted">Type</p>
              <p className="font-medium capitalize">{current.lpn_type}</p>
            </div>
            <div>
              <p className="text-muted">Location</p>
              <p className="font-medium">{current.location_name || "—"}</p>
            </div>
            <div>
              <p className="text-muted">Status</p>
              <p className="font-medium capitalize">{current.status}</p>
            </div>
          </div>
          {!hasContents ? (
            <p className="text-sm text-muted">This LPN has no contents yet. Use "Load Stock" to add stock from a location, or receive into it via a receipt.</p>
          ) : (
            <>
              {contents.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted mb-2">Products</p>
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
                        {contents.map((c, i) => (
                          <tr key={i}>
                            <td className="px-4 py-2 font-medium">{c.product_name}</td>
                            <td className="px-4 py-2 text-muted">{c.lot_number || "—"}</td>
                            <td className="px-4 py-2">{c.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {serials.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted mb-2">Serialized Items</p>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-app text-left">
                          <th className="px-4 py-2 font-medium text-muted">Product</th>
                          <th className="px-4 py-2 font-medium text-muted">Serial #</th>
                          <th className="px-4 py-2 font-medium text-muted">Lot</th>
                          <th className="px-4 py-2 font-medium text-muted">Status</th>
                          <th className="px-4 py-2 font-medium text-muted">Location</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {serials.map((s) => (
                          <tr key={s.serial_id}>
                            <td className="px-4 py-2 font-medium">{s.product_name}</td>
                            <td className="px-4 py-2">{s.serial_number}</td>
                            <td className="px-4 py-2 text-muted">{s.lot_number || "—"}</td>
                            <td className="px-4 py-2">{statusBadge(s.status) ? <span className={`badge ${statusBadge(s.status)}`}>{s.status}</span> : <span className="text-muted capitalize">{s.status}</span>}</td>
                            <td className="px-4 py-2 text-muted">{s.location_name || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <button onClick={() => setAction("activity")} className="btn-secondary">
              Activity
            </button>
            {can("lpns.update") && current.status === "active" && (
              <>
                <button onClick={() => setAction("load")} className="btn-secondary">
                  Load Stock
                </button>
                <button onClick={() => setAction("unload")} className="btn-secondary">
                  Unload Stock
                </button>
              </>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

type StockMode = "load" | "unload";

function LpnActivity({ lpnId, onClose }: { lpnId: number; onClose: () => void }) {
  const formatDate = useDateFormat();
  const { data, isLoading } = useQuery({
    queryKey: ["lpn", lpnId, "movements"],
    queryFn: async () => {
      const { data } = await api.get(`/lpns/${lpnId}/movements`, { params: { limit: 200 } });
      return data as StockMovement[];
    },
  });

  const movements = data || [];

  const activityLabel = (m: StockMovement) => {
    switch (m.reference_type) {
      case "lpn_load": return "Loaded into LPN";
      case "lpn_unload": return "Unloaded from LPN";
      case "lpn_move": return m.quantity_change > 0 ? "Moved into location" : "Moved to location";
      case "receipt": return "Received";
      case "asn": return "ASN received";
      case "shipment": return "Shipment pick";
      case "sale": return "Sale";
      case "purchase_order": return "Purchase order";
      case "cycle_count": return "Cycle count";
      default: return (m.reference_type || m.movement_type).replace(/_/g, " ");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">All stock movements recorded against this LPN.</p>
      {isLoading ? (
        <div className="border border-border rounded-lg p-6 text-sm text-muted">Loading activity...</div>
      ) : movements.length === 0 ? (
        <p className="text-sm text-muted">No movements recorded for this LPN yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="max-h-[45vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-2 font-medium text-muted">Date</th>
                  <th className="px-4 py-2 font-medium text-muted">Activity</th>
                  <th className="px-4 py-2 font-medium text-muted">Product</th>
                  <th className="px-4 py-2 font-medium text-muted">Qty</th>
                  <th className="px-4 py-2 font-medium text-muted">Route</th>
                  <th className="px-4 py-2 font-medium text-muted">Reference</th>
                  <th className="px-4 py-2 font-medium text-muted">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-muted whitespace-nowrap">{formatDate(m.created_at)}</td>
                    <td className="px-4 py-2">{activityLabel(m)}</td>
                    <td className="px-4 py-2 font-medium">{m.product_name}</td>
                    <td className="px-4 py-2">
                      <span className={m.quantity_change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                        {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {m.from_location_name || "—"} → {m.to_location_name || "—"}
                    </td>
                    <td className="px-4 py-2 text-muted">{m.reference || "—"}</td>
                    <td className="px-4 py-2 text-muted">{m.username || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </div>
  );
}

function LpnStockModal({ lpn, mode, onClose, onSaved }: { lpn: LPN; mode: StockMode; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const isLoad = mode === "load";
  const productList = useSelectableProducts();

  const contentProducts = lpn.contents.map((c) => c.product_id);
  const serialProducts = lpn.serials.map((s) => s.product_id);
  const lpnProductIds = new Set([...contentProducts, ...serialProducts]);
  const candidateProducts = (productList || []).filter((p) => (isLoad ? true : lpnProductIds.has(p.id)));

  const [product_id, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [lot_id, setLotId] = useState("");
  const [to_location_id, setToLocationId] = useState("");
  const [serialIds, setSerialIds] = useState<number[]>([]);
  const [sourceOverride, setSourceOverride] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedProduct = candidateProducts.find((p) => p.id === Number(product_id));
  const isSerialized = !!selectedProduct?.is_serialized;
  const from_location_id = isLoad ? (lpn.location_id ?? (sourceOverride ? Number(sourceOverride) : null)) : lpn.location_id;

  const { data: locations } = useQuery({
    queryKey: ["locations", "lpn-stock"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return data.items as Location[];
    },
  });
  const activeLocations = (locations || []).filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path));
  const sourceLocation = activeLocations.find((l) => l.id === from_location_id);
  const sourceIsQuarantine = sourceLocation?.location_type === "quarantine";

  const { data: stockLocations } = useQuery({
    queryKey: ["stock-locations", "lpn-load", product_id],
    queryFn: async () => {
      const { data } = await api.get("/stock-movements/locations", { params: { product_id } });
      return (data?.locations || []) as StockLocation[];
    },
    enabled: !!product_id && !isSerialized && isLoad,
  });

  const { data: looseSerials } = useQuery({
    queryKey: ["serial-numbers", "lpn-load", product_id, from_location_id],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", {
        params: { product_id, location_id: from_location_id, status: "in_stock", limit: 200 },
      });
      return (data.items as SerialNumber[]).filter((s) => s.lpn_id == null && (!s.lot_status || s.lot_status === "in_stock"));
    },
    enabled: !!product_id && isSerialized && isLoad && from_location_id != null,
  });

  const { data: looseQuarantinedSerials } = useQuery({
    queryKey: ["serial-numbers", "lpn-load", product_id, from_location_id, "quarantined"],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", {
        params: { product_id, location_id: from_location_id, status: "quarantined", limit: 200 },
      });
      return (data.items as SerialNumber[]).filter((s) => s.lpn_id == null && s.lot_status === "quarantined");
    },
    enabled: !!product_id && isSerialized && isLoad && from_location_id != null && sourceIsQuarantine,
  });

  const loadLocation = stockLocations?.find((l) => l.location_id === from_location_id);
  const loadAvailable = loadLocation?.quantity ?? 0;
  const unloadMax = (() => {
    if (!selectedProduct) return 0;
    const qty = lpn.contents.filter((c) => c.product_id === selectedProduct.id).reduce((sum, c) => sum + c.quantity, 0);
    const serialQty = lpn.serials.filter((s) => s.product_id === selectedProduct.id).length;
    return qty + serialQty;
  })();
  const maxQuantity = isSerialized ? 0 : isLoad ? loadAvailable : unloadMax;

  const unloadSerials = lpn.serials.filter((s) => s.product_id === Number(product_id));
  const loadSerialPool = (looseSerials || [])
    .concat(looseQuarantinedSerials || [])
    .filter((s) => !serialIds.includes(s.id));
  const unloadSerialPool = unloadSerials.filter((s) => !serialIds.includes(s.serial_id));

  const toggleSerial = (id: number) => {
    setSerialIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product_id) return addToast("Select a product", "error");
    if (isLoad && from_location_id == null) return addToast("Select a source location", "error");
    if (!isLoad && !to_location_id) return addToast("Select a destination location", "error");
    if (isSerialized) {
      if (serialIds.length === 0) return addToast("Select at least one serial number", "error");
    } else {
      const qty = parseInt(quantity) || 0;
      if (qty <= 0) return addToast("Enter a valid quantity", "error");
      if (maxQuantity > 0 && qty > maxQuantity) {
        return addToast(`Only ${maxQuantity} available`, "error");
      }
    }
    setSaving(true);
    try {
      const payload = {
        product_id: Number(product_id),
        lot_id: lot_id ? Number(lot_id) : null,
        ...(isSerialized ? { serial_ids: serialIds } : { quantity: parseInt(quantity) }),
        ...(isLoad ? { from_location_id: from_location_id } : { to_location_id: Number(to_location_id) }),
      };
      await api.post(`/lpns/${lpn.id}/${isLoad ? "items" : "unload"}`, payload);
      addToast(`Stock ${isLoad ? "loaded into" : "unloaded from"} ${lpn.lpn_number}`, "success");
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Operation failed", "error");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {isLoad
          ? `Move stock into ${lpn.lpn_number} from ${lpn.location_name || "a location"}.`
          : `Move stock out of ${lpn.lpn_number} to loose stock at a location.`}
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product *</label>
            <select className="select" value={product_id} onChange={(e) => { setProductId(e.target.value); setLotId(""); setSerialIds([]); }}>
              <option value="">Select...</option>
              {candidateProducts.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}{p.is_serialized ? " (Serialized)" : ""}</option>)}
            </select>
          </div>
          {isSerialized ? (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Serial Numbers ({serialIds.length} selected)</label>
              <div className="input h-auto min-h-10 bg-app font-mono text-sm">{serialIds.length > 0 ? `${serialIds.length} selected` : "Click serials below to add them"}</div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Quantity *</label>
              <input type="number" min={1} max={maxQuantity || undefined} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              <p className="text-xs text-muted mt-1">
                {isLoad ? `${loadAvailable} available at ${lpn.location_name || "the source"}` : `${unloadMax} in this LPN`}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isLoad ? (
            lpn.location_id == null ? (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Source Location *</label>
                <select className="select" value={sourceOverride} onChange={(e) => setSourceOverride(e.target.value)} required>
                  <option value="">Select...</option>
                  {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Source Location</label>
                <div className="input bg-app">{lpn.location_name || "—"}</div>
              </div>
            )
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Destination Location *</label>
              <select className="select" value={to_location_id} onChange={(e) => setToLocationId(e.target.value)} required>
                <option value="">Select...</option>
                {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
              </select>
            </div>
          )}
          {!isSerialized && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
              <select className="select" value={lot_id} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Any lot</option>
                {isLoad
                  ? (loadLocation?.lots || []).map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_number} ({l.quantity})</option>)
                  : lpn.contents.filter((c) => c.product_id === Number(product_id)).map((c, i) => (
                      <option key={`${c.lot_id ?? "nolot"}-${i}`} value={c.lot_id ?? ""}>{c.lot_number || "No lot"} ({c.quantity})</option>
                    ))}
              </select>
            </div>
          )}
        </div>

        {isSerialized && (
          <div>
            <p className="text-sm font-medium text-muted mb-2">{isLoad ? "Available serials" : "Serials in this LPN"}</p>
            {(() => {
              const pool = (isLoad ? loadSerialPool : unloadSerialPool).map((s) => ({
                key: isLoad ? (s as SerialNumber).id : (s as LPNSerialItem).serial_id,
                serial_number: s.serial_number,
                quarantined: s.status === "quarantined",
              }));
              if ((isLoad && !from_location_id) || pool.length === 0) {
                return <p className="text-xs text-muted">{isLoad ? "No loose serials available at the source." : "No serials for this product in the LPN."}</p>;
              }
              return (
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {pool.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      onClick={() => toggleSerial(s.key)}
                      className="text-xs font-mono px-2 py-1 rounded border border-border-strong bg-subtle text-ink hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                      {s.serial_number}
                      {s.quarantined && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">Q</span>}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : isLoad ? "Load Stock" : "Unload Stock"}
          </button>
        </div>
      </form>
    </div>
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
