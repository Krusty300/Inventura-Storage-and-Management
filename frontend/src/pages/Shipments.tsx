import { useState } from "react";
import { Box, PackageCheck, XCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Customer, PaginatedResponse, Shipment, ShipmentStats } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 25;

export default function Shipments() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [deleting, setDeleting] = useState<Shipment | null>(null);
  const [viewing, setViewing] = useState<Shipment | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();

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

  const { data, isLoading } = useQuery({
    queryKey: ["shipments", page],
    queryFn: async () => {
      const { data } = await api.get("/shipments", { params: { skip: ((page - 1) * PAGE_SIZE).toString(), limit: PAGE_SIZE.toString() } });
      return data as PaginatedResponse<Shipment>;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["shipments", "stats"],
    queryFn: async () => (await api.get("/shipments/stats")).data as ShipmentStats,
  });

  const shipments = data?.items || [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shipments"] });

  const statusBadge = (s: string) =>
    s === "shipped" ? "badge-success" : s === "packed" ? "badge-info" : s === "picking" ? "badge-warning" : s === "cancelled" ? "badge-danger" : "badge";

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
        <Skeleton rows={8} cols={5} />
      ) : shipments.length === 0 ? (
        <EmptyState title="No shipments" message="Create a shipment to start the picking workflow." />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-3 font-medium text-muted">Shipment</th>
                  <th className="px-4 py-3 font-medium text-muted">Customer</th>
                  <th className="px-4 py-3 font-medium text-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-muted">Items</th>
                  <th className="px-4 py-3 font-medium text-muted">Qty</th>
                  <th className="px-4 py-3 font-medium text-muted">Invoice</th>
                  <th className="px-4 py-3 font-medium text-muted">Carrier / Tracking</th>
                  <th className="px-4 py-3 font-medium text-muted">Created</th>
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
                    <td className="px-4 py-3 text-muted">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setViewing(s)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                          View
                        </button>
                        {s.status !== "shipped" && can("shipments.update") && (
                          <button onClick={() => setEditing(s)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                            Edit
                          </button>
                        )}
                        {(s.status === "draft" || s.status === "cancelled") && can("shipments.delete") && (
                          <button onClick={() => setDeleting(s)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1 hover:border-red-300 dark:border-red-500/40 hover:text-red-600 dark:text-red-400" aria-label={`Delete ${s.shipment_number}`}>
                            Delete
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
        <Pagination page={page} totalPages={data.pages} pageSize={PAGE_SIZE} onPageChange={setPage} />
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
  const [rows, setRows] = useState([{ product_id: "", quantity: "1" }]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const isEdit = !!shipment;

  const { data: customersData } = useQuery({
    queryKey: ["customers", "select"],
    queryFn: async () => (await api.get("/customers", { params: { limit: 1000 } })).data as PaginatedResponse<Customer>,
  });
  const customers = customersData?.items || [];

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
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
        .map((r) => ({ product_id: Number(r.product_id), quantity: parseInt(r.quantity) || 0 }))
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
    <Modal open onClose={onClose} title={isEdit ? `Edit ${shipment!.shipment_number}` : "New Shipment"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
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
              {rows.map((row, idx) => {
                return (
                  <div key={idx} className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-ink mb-1">Product</label>
                      <select className="select" value={row.product_id} onChange={(e) => setRow(idx, "product_id", e.target.value)}>
                        <option value="">Select product...</option>
                        {products.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                          <option key={p.id} value={p.id}>{productLabel(p)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
                      <input type="number" min={1} className="input" value={row.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                    </div>
                    <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400 mb-1" aria-label="Remove line">
                      <XCircle size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1" }])} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400">
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

function ShipmentDetail({ shipment, onClose, onChanged }: { shipment: Shipment; onClose: () => void; onChanged: () => void }) {
  const [carrier, setCarrier] = useState(shipment.carrier);
  const [tracking, setTracking] = useState(shipment.tracking_number);
  const [busy, setBusy] = useState<string | null>(null);
  const { addToast } = useToast();
  const { can } = useAuth();

  const run = async (action: string, url: string, okMsg: string) => {
    setBusy(action);
    try {
      await api.post(url);
      addToast(okMsg, "success");
      onChanged();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Action failed", "error");
    }
    setBusy(null);
  };

  const ship = async () => {
    setBusy("ship");
    try {
      await api.post(`/shipments/${shipment.id}/ship`, null, { params: { carrier, tracking_number: tracking } });
      addToast(`${shipment.shipment_number} shipped`, "success");
      onChanged();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error shipping", "error");
    }
    setBusy(null);
  };

  const canPick = (shipment.status === "draft" || shipment.status === "picking") && can("shipments.pick");
  const canPack = shipment.status === "picking" && can("shipments.pick");
  const canShip = (shipment.status === "picking" || shipment.status === "packed") && can("shipments.ship");
  const canCancel = (shipment.status === "draft" || shipment.status === "picking") && can("shipments.cancel");
  const canCreateSale = shipment.status === "shipped" && !shipment.sale_id && can("sales.create");

  const createSale = async () => {
    setBusy("invoice");
    try {
      const { data } = await api.post(`/shipments/${shipment.id}/create-sale`);
      addToast(`Invoice ${data.invoice_number} created`, "success");
      onChanged();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error creating invoice", "error");
    }
    setBusy(null);
  };

  return (
    <Modal open onClose={onClose} title={shipment.shipment_number} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-muted">Status</p><p className="font-medium capitalize">{shipment.status}</p></div>
          <div><p className="text-muted">Customer</p><p className="font-medium">{shipment.customer_name || "—"}</p></div>
          <div><p className="text-muted">Carrier</p><p className="font-medium">{shipment.carrier || "—"}</p></div>
          <div><p className="text-muted">Tracking</p><p className="font-medium">{shipment.tracking_number || "—"}</p></div>
          <div><p className="text-muted">Invoice</p><p className="font-medium">{shipment.invoice_number || "—"}</p></div>
          <div><p className="text-muted">Amount</p><p className="font-medium">{shipment.total_amount ? `$${shipment.total_amount.toFixed(2)}` : "—"}</p></div>
          <div><p className="text-muted">Created By</p><p className="font-medium">{shipment.username}</p></div>
          <div><p className="text-muted">Created</p><p className="font-medium">{new Date(shipment.created_at).toLocaleDateString()}</p></div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Product</th>
                <th className="px-4 py-2 font-medium text-muted">Ordered</th>
                <th className="px-4 py-2 font-medium text-muted">Picked</th>
                <th className="px-4 py-2 font-medium text-muted">Packed</th>
                <th className="px-4 py-2 font-medium text-muted">Shipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shipment.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}{item.is_serialized && <span className="ml-2 badge-info">serialized</span>}</td>
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
                <button onClick={() => run("pick", `/shipments/${shipment.id}/pick`, "Picked")} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1">
                  <PackageCheck size={14} /> Pick
                </button>
              )}
              {canPack && (
                <button onClick={() => run("pack", `/shipments/${shipment.id}/pack`, "Packed")} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1">
                  <Box size={14} /> Pack
                </button>
              )}
              {canShip && (
                <button onClick={ship} disabled={busy !== null} className="btn-primary inline-flex items-center gap-1">
                  Ship
                </button>
              )}
            </div>
          </div>
        )}
        {canCreateSale && (
          <div className="flex justify-end">
            <button onClick={createSale} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1">
              Create Invoice
            </button>
          </div>
        )}
        {shipment.status !== "shipped" && shipment.status !== "cancelled" && canCancel && (
          <div className="flex justify-end">
            <button onClick={() => run("cancel", `/shipments/${shipment.id}/cancel`, "Cancelled")} disabled={busy !== null} className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:text-red-400 inline-flex items-center gap-1">
              Cancel shipment
            </button>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}
