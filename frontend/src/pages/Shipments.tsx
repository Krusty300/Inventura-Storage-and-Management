import { useDateFormat } from "../hooks/useDateFormat";
import { statusBadge } from "../utils/statusBadges";
import { useState } from "react";
import { Eye, FileText, Pencil, Trash2, XCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Customer, PaginatedResponse, SerialNumber, Shipment, ShipmentItem, ShipmentStats } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { productLabel } from "../utils/variants";
import type { Product } from "../types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageSize } from "../hooks/usePageSize";

export default function Shipments() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [deleting, setDeleting] = useState<Shipment | null>(null);
  const [viewing, setViewing] = useState<Shipment | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { pageSize, setPageSize } = usePageSize();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shipments/${id}`),
    onSuccess: () => {
      addToast("Shipment deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || "Cannot delete shipment", "error");
    },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["shipments", debouncedSearch, statusFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      const { data } = await api.get("/shipments", { params });
      return data as PaginatedResponse<Shipment>;
    },
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery({
    queryKey: ["shipments", "stats"],
    queryFn: async () => (await api.get("/shipments/stats")).data as ShipmentStats,
  });

  const shipments = data?.items || [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shipments"] });

  const statCards = stats
    ? [
        { label: "Open", value: stats.open, color: "text-indigo-600 dark:text-indigo-400" },
        { label: "Picking", value: stats.counts.picking ?? 0, color: "text-amber-600 dark:text-amber-400" },
        { label: "Packed", value: stats.counts.packed ?? 0, color: "text-sky-600" },
        { label: "Shipped", value: stats.counts.shipped ?? 0, color: "text-green-600 dark:text-green-400" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-ink">Shipments</h1>
        {can("shipments.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-2">
            New Shipment
          </button>
        )}
      </div>

      {isError && (
        <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          Failed to load shipments: {(error as any)?.message}
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by shipment number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search shipments" />
        </div>
        <select className="select w-auto" aria-label="Filter by status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="picking">Picking</option>
          <option value="packed">Packed</option>
          <option value="shipped">Shipped</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {statCards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((c) => (
            <div key={c.label} className="card">
              <p className="text-sm text-muted">{c.label}</p>
              <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton variant="rows" rows={8} cols={5} />
      ) : shipments.length === 0 ? (
        <EmptyState variant="block" title="No shipments" message="Create a shipment to start the picking workflow." />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Shipment</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Items</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Qty</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Invoice</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Carrier / Tracking</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Created</th>
                  <th className="px-4 py-3 font-medium text-muted" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shipments.map((s) => (
                  <tr key={s.id} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{s.shipment_number}</td>
                    <td className="px-4 py-3 text-muted">{s.customer_name || "—"}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusBadge(s.status)} capitalize`}>{s.status}</span></td>
                    <td className="px-4 py-3">{s.items.length}</td>
                    <td className="px-4 py-3">{s.total_quantity}</td>
                    <td className="px-4 py-3 text-muted">{s.invoice_number || "—"}</td>
                    <td className="px-4 py-3 text-muted">{s.carrier || "—"}{s.tracking_number ? ` / ${s.tracking_number}` : ""}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(s.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {s.status === "draft" && (
                          <button onClick={() => setViewing(s)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" title={`View ${s.shipment_number}`} aria-label={`Draft ${s.shipment_number}`}>
                            <FileText size={16} />
                          </button>
                        )}
                        <button onClick={() => setViewing(s)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" title={`View ${s.shipment_number}`} aria-label={`View ${s.shipment_number}`}>
                          <Eye size={16} />
                        </button>
                        {s.status !== "shipped" && can("shipments.update") && (
                          <button onClick={() => setEditing(s)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" title={`Edit ${s.shipment_number}`} aria-label={`Edit ${s.shipment_number}`}>
                            <Pencil size={16} />
                          </button>
                        )}
                        {(s.status === "draft" || s.status === "cancelled") && can("shipments.delete") && (
                          <button onClick={() => setDeleting(s)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${s.shipment_number}`}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.pages > 1 && (
        <Pagination page={page} totalPages={data.pages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
      )}

      {showForm && <ShipmentForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />}
      {editing && <ShipmentForm shipment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {deleting && (
        <ConfirmDialog
          open
          title="Delete shipment"
          message={`Are you sure you want to delete shipment "${deleting.shipment_number}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { deleteMutation.mutate(deleting.id); setDeleting(null); }}
          onCancel={() => setDeleting(null)}
        />
      )}
      {viewing && <ShipmentDetail shipment={viewing} onClose={() => setViewing(null)} onChanged={refresh} />}
    </div>
  );
}

function ShipmentForm({ shipment, onClose, onSaved }: { shipment?: Shipment; onClose: () => void; onSaved: () => void }) {
  const products = useSelectableProducts();
  const [customerId, setCustomerId] = useState(shipment ? (shipment.customer_id ? String(shipment.customer_id) : "") : "");
  const [carrier, setCarrier] = useState(shipment?.carrier || "");
  const [trackingNumber, setTrackingNumber] = useState(shipment?.tracking_number || "");
  const [notes, setNotes] = useState(shipment?.notes || "");
  const [rows, setRows] = useState([{ product_id: "", quantity: "1", location_id: "" }]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const isEdit = !!shipment;

  const { data: customersData } = useQuery({
    queryKey: ["customers", "select"],
    queryFn: async () => (await api.get("/customers", { params: { limit: PAGE_SIZE_PRODUCTS } })).data as PaginatedResponse<Customer>,
  });
  const customers = customersData?.items || [];

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value, ...(key === "product_id" ? { location_id: "" } : {}) } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      customer_id: customerId ? Number(customerId) : null,
      carrier,
      tracking_number: trackingNumber,
      notes,
    };
    if (!isEdit) {
      const items = rows
        .filter((r) => r.product_id)
        .map((r) => ({
          product_id: Number(r.product_id),
          quantity: parseInt(r.quantity) || 0,
          location_id: r.location_id ? Number(r.location_id) : null,
        }))
        .filter((r) => r.quantity > 0);
      if (items.length === 0) {
        addToast("Add at least one line item", "error");
        return;
      }
      payload.items = items;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/shipments/${shipment!.id}`, payload);
        addToast("Shipment updated", "success");
      } else {
        await api.post("/shipments", payload);
        addToast("Shipment created", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || (isEdit ? "Error updating shipment" : "Error creating shipment"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${shipment!.shipment_number}` : "New Shipment"} xwide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Carrier</label>
            <input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Tracking Number</label>
            <input className="input" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="1Z..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Customer</label>
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">No customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        {!isEdit && (
          <>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <ShipmentLineRow key={idx} index={idx} row={row} products={products} onChange={setRow} onRemove={(i) => setRows(rows.filter((_, n) => n !== i))} />
              ))}
            </div>
            <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1", location_id: "" }])} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400">
              Add line
            </button>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : isEdit ? "Save Changes" : "Create Shipment"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ShipmentLineRow({
  index,
  row,
  products,
  onChange,
  onRemove,
}: {
  index: number;
  row: { product_id: string; quantity: string; location_id: string };
  products: Product[];
  onChange: (idx: number, key: string, value: string) => void;
  onRemove: (idx: number) => void;
}) {
  const selectedProduct = products.find((p) => String(p.id) === row.product_id);
  const { locations, unallocated, isLoading } = useProductStockLocations(
    selectedProduct?.id,
    selectedProduct?.is_serialized ?? false
  );

  return (
    <div className="grid grid-cols-12 gap-3 items-end">
      <div className="col-span-12 sm:col-span-5">
        <label className="block text-sm font-medium text-ink mb-1">Product</label>
        <select className="select w-full" aria-label="Product" value={row.product_id} onChange={(e) => onChange(index, "product_id", e.target.value)}>
          <option value="">Select product...</option>
          {products.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
            <option key={p.id} value={p.id}>{productLabel(p)}</option>
          ))}
        </select>
      </div>
      <div className="col-span-4 sm:col-span-2">
        <label className="block text-sm font-medium text-ink mb-1">Qty</label>
        <input type="number" min={1} className="input w-full" value={row.quantity} onChange={(e) => onChange(index, "quantity", e.target.value)} />
      </div>
      <div className="col-span-7 sm:col-span-4">
        <label className="block text-sm font-medium text-ink mb-1">Source location</label>
        <select className="select w-full" value={row.location_id} onChange={(e) => onChange(index, "location_id", e.target.value)} aria-label="Source location">
          <option value="">Any location (auto)</option>
          {locations.map((l) => (
            <option key={l.location_id} value={String(l.location_id)}>{l.path} ({l.count})</option>
          ))}
        </select>
        {isLoading && <p className="text-xs text-faint mt-1">Loading locations...</p>}
        {!isLoading && unallocated > 0 && (
          <p className="text-xs text-faint mt-1">
            Plus {unallocated} unallocated unit{unallocated === 1 ? "" : "s"} - pick with "Any location"
          </p>
        )}
      </div>
      <div className="col-span-1 flex justify-end">
        <button type="button" onClick={() => onRemove(index)} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove line">
          <XCircle size={16} />
        </button>
      </div>
    </div>
  );
}

function serializedLineStatus(item: ShipmentItem) {
  if (item.quantity_shipped > 0) return { label: "shipped", cls: "badge-success" };
  if (item.quantity_packed > 0) return { label: "packed", cls: "badge-info" };
  if (item.quantity_picked > 0) return { label: "picking", cls: "badge-warning" };
  return { label: "pending", cls: "badge-neutral" };
}

function ShipmentDetail({ shipment, onClose, onChanged }: { shipment: Shipment; onClose: () => void; onChanged: () => void }) {
  const formatDate = useDateFormat();
  const [carrier, setCarrier] = useState(shipment.carrier);
  const [tracking, setTracking] = useState(shipment.tracking_number);
  const [paymentMethod, setPaymentMethod] = useState(shipment.payment_method || "cash");
  const [busy, setBusy] = useState<string | null>(null);
  const [pickingSerials, setPickingSerials] = useState(false);
  const { addToast } = useToast();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const { data: liveShipment } = useQuery({
    queryKey: ["shipment", shipment.id],
    queryFn: async () => (await api.get(`/shipments/${shipment.id}`)).data as Shipment,
    initialData: shipment,
    refetchInterval: 15000,
  });
  const current = liveShipment ?? shipment;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["shipment", shipment.id] });
    onChanged();
  };

  const run = async (action: string, url: string, okMsg: string) => {
    setBusy(action);
    try {
      await api.post(url);
      addToast(okMsg, "success");
      refresh();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Action failed", "error");
    }
    setBusy(null);
  };

  const handlePick = () => {
    const needsSerials = current.items.some(
      (i) => i.is_serialized && i.quantity_picked < i.quantity_ordered
    );
    if (needsSerials) {
      setPickingSerials(true);
    } else {
      run("pick", `/shipments/${current.id}/pick`, "Picked");
    }
  };

  const ship = async () => {
    setBusy("ship");
    try {
      await api.post(`/shipments/${current.id}/ship`, null, { params: { carrier, tracking_number: tracking } });
      addToast(`${current.shipment_number} shipped`, "success");
      refresh();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error shipping", "error");
    }
    setBusy(null);
  };

  const canPick = (current.status === "draft" || current.status === "picking") && can("shipments.pick");
  const canPack = current.status === "picking" && can("shipments.pick");
  const canShip = (current.status === "picking" || current.status === "packed") && can("shipments.ship");
  const canCancel = (current.status === "draft" || current.status === "picking") && can("shipments.cancel");
  const canCreateSale = current.status === "shipped" && !current.sale_id && can("sales.create");

  const createSale = async () => {
    setBusy("invoice");
    try {
      const { data } = await api.post(`/shipments/${current.id}/create-sale`, null, { params: { payment_method: paymentMethod } });
      addToast(`Invoice ${data.invoice_number} created`, "success");
      refresh();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error creating invoice", "error");
    }
    setBusy(null);
  };

  return (
    <Modal open onClose={onClose} title={current.shipment_number} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-muted">Status</p><p className="font-medium capitalize">{current.status}</p></div>
          <div><p className="text-muted">Customer</p><p className="font-medium">{current.customer_name || "—"}</p></div>
          <div><p className="text-muted">Carrier</p><p className="font-medium">{current.carrier || "—"}</p></div>
          <div><p className="text-muted">Tracking</p><p className="font-medium">{current.tracking_number || "—"}</p></div>
          <div><p className="text-muted">Invoice</p><p className="font-medium">{current.invoice_number || "—"}</p></div>
          <div><p className="text-muted">Payment</p><p className="font-medium capitalize">{current.payment_method || "—"}</p></div>
          <div><p className="text-muted">Amount</p><p className="font-medium">{current.total_amount ? `$${current.total_amount.toFixed(2)}` : "—"}</p></div>
          <div><p className="text-muted">Created By</p><p className="font-medium">{current.username}</p></div>
          <div><p className="text-muted">Created</p><p className="font-medium">{formatDate(current.created_at)}</p></div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Product</th>
                <th className="px-4 py-2 font-medium text-muted">Source</th>
                <th className="px-4 py-2 font-medium text-muted">Ordered</th>
                <th className="px-4 py-2 font-medium text-muted">Picked</th>
                <th className="px-4 py-2 font-medium text-muted">Packed</th>
                <th className="px-4 py-2 font-medium text-muted">Shipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {current.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">
                    {item.product_name}
                    {item.is_serialized && (
                      <>
                        <span className="ml-2 badge badge-info">serialized</span>
                        <span className={`ml-1 badge ${serializedLineStatus(item).cls} capitalize`}>{serializedLineStatus(item).label}</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">{item.location_name || "—"}</td>
                  <td className="px-4 py-2">{item.quantity_ordered}</td>
                  <td className="px-4 py-2">{item.quantity_picked}</td>
                  <td className="px-4 py-2">{item.quantity_packed}</td>
                  <td className="px-4 py-2">{item.quantity_shipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(canShip || canPack || canPick) && (
          <div className="flex items-end gap-3 flex-wrap">
            {(canShip) && (
              <>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Carrier</label>
                  <input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Tracking</label>
                  <input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                </div>
              </>
            )}
            <div className="ml-auto flex gap-2">
              {canPick && (
                <button onClick={handlePick} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1">
                  Pick
                </button>
              )}
              {canPack && (
                <button onClick={() => run("pack", `/shipments/${current.id}/pack`, "Packed")} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1">
                  Pack
                </button>
              )}
              {canShip && (
                <button onClick={ship} disabled={busy !== null} className="btn-primary inline-flex items-center gap-1">
                  Product Shipping
                </button>
              )}
            </div>
          </div>
        )}
        {canCreateSale && (
          <div className="flex items-center gap-3 justify-end">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Payment Method</label>
              <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} aria-label="Payment method">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="transfer">Bank Transfer</option>
              </select>
            </div>
            <button onClick={createSale} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1">
              Create Invoice
            </button>
          </div>
        )}
        {current.status !== "shipped" && current.status !== "cancelled" && canCancel && (
          <div className="flex justify-end">
            <button onClick={() => run("cancel", `/shipments/${current.id}/cancel`, "Cancelled")} disabled={busy !== null} className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:text-red-400 inline-flex items-center gap-1">
              Cancel Shipment
            </button>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
      {pickingSerials && (
        <PickSerialsModal
          shipment={current}
          onClose={() => setPickingSerials(false)}
          onPicked={() => { setPickingSerials(false); refresh(); }}
        />
      )}
    </Modal>
  );
}

function SerializedPickRow({ item, selected, onSelect }: {
  item: ShipmentItem;
  selected: Set<number>;
  onSelect: (serialIds: number[]) => void;
}) {
  const remaining = item.quantity_ordered - item.quantity_picked;
  const locationId = item.location_id ?? undefined;

  const { data: serials = [] } = useQuery({
    queryKey: ["serial-numbers", "shipment-pick", item.product_id, locationId ?? "any"],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", {
        params: { product_id: item.product_id, status: "in_stock", limit: PAGE_SIZE, ...(locationId ? { location_id: locationId } : {}) },
      });
      return data.items as SerialNumber[];
    },
  });

  const toggle = (serialId: number) => {
    const next = new Set(selected);
    if (next.has(serialId)) next.delete(serialId);
    else next.add(serialId);
    onSelect([...next]);
  };

  const allSelected = selected.size === serials.length && serials.length > 0;

  return (
    <div className="border border-border rounded-lg p-3">
      <p className="text-sm font-medium mb-1">
        {item.product_name} <span className="text-muted font-normal">- pick {remaining}</span>
      </p>
      {serials.length === 0 ? (
        <p className="text-sm text-faint">No in-stock serials found.</p>
      ) : (
        <>
          <div className="border border-border rounded-lg divide-y divide-border max-h-40 overflow-y-auto">
            {serials.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span className="text-ink">{s.serial_number}</span>
                {s.lot_number && <span className="text-muted text-xs">Lot {s.lot_number}</span>}
              </label>
            ))}
          </div>
          <div className="flex justify-between items-center mt-2 text-sm">
            <span className="text-muted">{selected.size} of {remaining} selected</span>
            <button
              type="button"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => onSelect(allSelected ? [] : serials.map((s) => s.id))}
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PickSerialsModal({ shipment, onClose, onPicked }: {
  shipment: Shipment;
  onClose: () => void;
  onPicked: () => void;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});

  const serializedItems = shipment.items.filter(
    (i) => i.is_serialized && i.quantity_picked < i.quantity_ordered
  );

  const setSerialIds = (productId: number, serialIds: number[]) => {
    setSelected((prev) => ({ ...prev, [productId]: new Set(serialIds) }));
  };

  const allFilled = serializedItems.every((item) => {
    const remaining = item.quantity_ordered - item.quantity_picked;
    return (selected[item.product_id]?.size ?? 0) === remaining;
  });

  const submit = async () => {
    setBusy(true);
    try {
      const items = serializedItems.map((item) => ({
        product_id: item.product_id,
        serial_ids: [...(selected[item.product_id] ?? [])],
      }));
      await api.post(`/shipments/${shipment.id}/pick`, { items });
      addToast("Picked", "success");
      onPicked();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error picking shipment", "error");
    }
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} title="Select Serial Numbers" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Choose the exact serial numbers to pick for each serialized line. Lines you don't touch are auto-allocated.
        </p>
        <div className="space-y-3 max-h-[50vh] overflow-auto">
          {serializedItems.map((item) => (
            <SerializedPickRow
              key={item.id}
              item={item}
              selected={selected[item.product_id] ?? new Set()}
              onSelect={(ids) => setSerialIds(item.product_id, ids)}
            />
          ))}
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" disabled={!allFilled || busy} onClick={submit} className="btn-primary">
            {busy ? "Picking..." : "Pick Selected"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
