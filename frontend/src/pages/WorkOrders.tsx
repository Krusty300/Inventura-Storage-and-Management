import { useDateFormat } from "../hooks/useDateFormat";
import { statusBadge } from "../utils/statusBadges";
import { useEffect, useState } from "react";
import { CheckCircle, Eye, Pencil, Play, Plus, Printer, Rocket, XCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { BOM, Location, PaginatedResponse, WorkOrder, WorkOrderCost, WorkOrderGenealogy } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";

export default function WorkOrders() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [viewing, setViewing] = useState<WorkOrder | null>(null);
  const [completing, setCompleting] = useState<WorkOrder | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["work-orders", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/work-orders", { params });
      return data as PaginatedResponse<WorkOrder>;
    },
  });

  const wos = data?.items || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const priorityBadge = (p: string) =>
    p === "high" ? "badge-danger" : p === "low" ? "badge-success" : "badge-info";

  const run = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      addToast(msg, "success");
      refresh();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Action failed", "error");
    }
  };

  const printPdf = async (w: WorkOrder) => {
    try {
      const { data } = await api.get(`/work-orders/${w.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Work Orders</h1>
        {can("work_orders.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            New Work Order
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by work order number, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search work orders" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Work orders table">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">WO #</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Qty</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Priority</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Issued</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Created</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={8} />
            ) : wos.length === 0 ? (
              <EmptyState title="No work orders yet" message="Plan a work order to build a product from a BOM or component list." actionLabel="New Work Order" onAction={() => { setEditing(null); setShowForm(true); }} />
            ) : wos.map((w) => (
              <tr key={w.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{w.wo_number}</td>
                <td className="px-4 py-3 text-muted">{w.product_name}</td>
                <td className="px-4 py-3">{w.quantity}</td>
                <td className="px-4 py-3"><span className={`badge ${priorityBadge(w.priority)}`}>{w.priority}</span></td>
                <td className="px-4 py-3">
                  <span className={!w.fully_issued && w.status !== "planned" ? "text-orange-600 dark:text-orange-400" : ""}>
                    {w.total_issued}/{w.total_required}
                  </span>
                </td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(w.status)}`}>{w.status}</span></td>
                <td className="px-4 py-3 text-muted">{formatDate(w.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => printPdf(w)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print ${w.wo_number}`}><Printer size={16} /></button>
                    <button onClick={() => setViewing(w)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${w.wo_number}`}><Eye size={16} /></button>
                    {w.status === "planned" && can("work_orders.update") && (
                      <>
                        <button onClick={() => { setEditing(w); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${w.wo_number}`}><Pencil size={16} /></button>
                        <button onClick={() => run(() => api.post(`/work-orders/${w.id}/cancel`), `${w.wo_number} cancelled`)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Cancel ${w.wo_number}`}><XCircle size={16} /></button>
                      </>
                    )}
                    {(w.status === "released" || w.status === "in_progress") && can("work_orders.update") && (
                      <button onClick={() => run(() => api.post(`/work-orders/${w.id}/cancel`), `${w.wo_number} cancelled`)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Cancel ${w.wo_number}`}><XCircle size={16} /></button>
                    )}
                    {w.status === "planned" && can("work_orders.release") && (
                      <button onClick={() => run(() => api.post(`/work-orders/${w.id}/release`), `${w.wo_number} released`)} className="p-1 text-faint hover:text-green-600 dark:text-green-400" aria-label={`Release ${w.wo_number}`}><Rocket size={16} /></button>
                    )}
                    {w.status === "released" && can("work_orders.release") && (
                      <button onClick={() => run(() => api.post(`/work-orders/${w.id}/start`), `${w.wo_number} started`)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Start ${w.wo_number}`}><Play size={16} /></button>
                    )}
                    {(w.status === "released" || w.status === "in_progress") && can("work_orders.complete") && (
                      <button onClick={() => setCompleting(w)} className="p-1 text-faint hover:text-green-600 dark:text-green-400" aria-label={`Complete ${w.wo_number}`}><CheckCircle size={16} /></button>
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
        <WorkOrderForm
          wo={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && <WorkOrderDetail wo={viewing} onClose={() => setViewing(null)} />}

      {completing && (
        <CompleteModal
          wo={completing}
          onClose={() => setCompleting(null)}
          onSaved={() => { setCompleting(null); refresh(); }}
        />
      )}
    </div>
  );
}

function useManufacturableProducts() {
  const all = useSelectableProducts();
  return all.filter((p) => !p.is_variant && !(p.variants && p.variants.length > 0));
}

function WorkOrderForm({ wo, onClose, onSaved }: { wo: WorkOrder | null; onClose: () => void; onSaved: () => void }) {
  const products = useManufacturableProducts();
  const [productId, setProductId] = useState(wo ? String(wo.product_id) : "");
  const [quantity, setQuantity] = useState(wo ? String(wo.quantity) : "1");
  const [priority, setPriority] = useState(wo?.priority || "normal");
  const [notes, setNotes] = useState(wo?.notes || "");
  const [mode, setMode] = useState<"bom" | "items">(wo?.bom_id ? "bom" : "items");
  const [boms, setBoms] = useState<BOM[]>([]);
  const [bomId, setBomId] = useState(wo?.bom_id ? String(wo.bom_id) : "");
  const [rows, setRows] = useState(
    wo?.items.map((i) => ({ product_id: String(i.product_id), quantity: String(i.quantity_required) })) || [{ product_id: "", quantity: "1" }]
  );
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (!productId) {
      setBoms([]);
      setBomId("");
      return;
    }
    api.get("/boms", { params: { product_id: productId, limit: PAGE_SIZE } }).then(({ data }) => setBoms(data.items));
  }, [productId]);

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      addToast("Select an output product", "error");
      return;
    }
    const qty = parseInt(quantity) || 1;
    setSaving(true);
    try {
      const payload: any = {
        product_id: Number(productId),
        quantity: qty,
        priority,
        notes: notes.trim(),
      };
      if (mode === "bom") {
        if (!bomId) {
          addToast("Select a BOM or switch to manual items", "error");
          setSaving(false);
          return;
        }
        payload.bom_id = Number(bomId);
      } else {
        const items = rows
          .filter((r) => r.product_id)
          .map((r) => ({ product_id: Number(r.product_id), quantity_required: parseInt(r.quantity) || 1 }));
        if (items.length === 0) {
          addToast("Add at least one component", "error");
          setSaving(false);
          return;
        }
        payload.items = items;
      }
      if (wo) {
        await api.put(`/work-orders/${wo.id}`, { quantity: qty, priority, notes: notes.trim() });
        addToast("Work order updated", "success");
      } else {
        const { data } = await api.post("/work-orders", payload);
        addToast(`Work order ${data.wo_number} created`, "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving work order", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={wo ? `Edit ${wo.wo_number}` : "New Work Order"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Output Product</label>
            <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!!wo} required>
              <option value="">Select product...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
            <input type="number" min={1} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Priority</label>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {!wo && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-indigo-600" checked={mode === "bom"} onChange={() => setMode("bom")} /> Use BOM
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-indigo-600" checked={mode === "items"} onChange={() => setMode("items")} /> Manual components
            </label>
          </div>
        )}

        {mode === "bom" ? (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Bill of Materials</label>
            <select className="select" value={bomId} onChange={(e) => setBomId(e.target.value)} required>
              <option value="">Select BOM...</option>
              {boms.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.item_count} components, {b.total_cost.toFixed(2)})</option>)}
            </select>
            {boms.length === 0 && productId && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">No BOMs found for this product. Create one on the BOMs page or use manual components.</p>
            )}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-app px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Components</span>
              <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1" }])} className="btn-secondary text-xs py-1 px-2">
                <Plus size={14} className="inline mr-1" />Add Component
              </button>
            </div>
            <div className="divide-y divide-border max-h-[40vh] overflow-auto">
              {rows.map((row, idx) => (
                <div key={idx} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
                  <div className="sm:col-span-8">
                    <label className="block text-xs font-medium text-muted mb-1">Product</label>
                    <select className="select" value={row.product_id} onChange={(e) => setRow(idx, "product_id", e.target.value)}>
                      <option value="">Select...</option>
                      {products.filter((p) => p.id !== Number(productId)).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-muted mb-1">Qty</label>
                    <input type="number" min={1} className="input" value={row.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove component">
                      <XCircle size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !productId} className="btn-primary">{saving ? "Saving..." : "Save Work Order"}</button>
        </div>
      </form>
    </Modal>
  );
}

function WorkOrderDetail({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const formatDate = useDateFormat();
  const { data: genealogy } = useQuery({
    queryKey: ["work-order-genealogy", wo.id],
    queryFn: async () => {
      const { data } = await api.get(`/work-orders/${wo.id}/genealogy`);
      return data as WorkOrderGenealogy;
    },
  });
  return (
    <Modal open onClose={onClose} title={wo.wo_number} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted">Product</p>
            <p className="font-medium">{wo.product_name}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p className="font-medium capitalize">{wo.status}</p>
          </div>
          <div>
            <p className="text-muted">Created By</p>
            <p className="font-medium">{wo.username}</p>
          </div>
          <div>
            <p className="text-muted">Quantity</p>
            <p className="font-medium">{wo.quantity}</p>
          </div>
          <div>
            <p className="text-muted">BOM</p>
            <p className="font-medium">{wo.bom_name || "Manual components"}</p>
          </div>
          <div>
            <p className="text-muted">Started</p>
            <p className="font-medium">{wo.started_at ? formatDate(wo.started_at) : "—"}</p>
          </div>
          {wo.notes && (
            <div className="col-span-3">
              <p className="text-muted">Notes</p>
              <p className="font-medium">{wo.notes}</p>
            </div>
          )}
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Component</th>
                <th className="px-4 py-2 font-medium text-muted">Required</th>
                <th className="px-4 py-2 font-medium text-muted">Issued</th>
                <th className="px-4 py-2 font-medium text-muted">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {wo.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}</td>
                  <td className="px-4 py-2">{item.quantity_required}</td>
                  <td className="px-4 py-2">{item.quantity_issued}</td>
                  <td className="px-4 py-2">{Math.max(0, item.quantity_required - item.quantity_issued)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <GenealogySection genealogy={genealogy} woNumber={wo.wo_number} />
        <CostSection woId={wo.id} />
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function CostSection({ woId }: { woId: number }) {
  const { data: cost, isLoading } = useQuery({
    queryKey: ["work-order-cost", woId],
    queryFn: async () => {
      const { data } = await api.get(`/costing/work-orders/${woId}`);
      return data as WorkOrderCost;
    },
  });
  if (isLoading || !cost) return null;
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink">Manufacturing Cost</h4>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div className="rounded-lg bg-app p-3">
          <p className="text-muted">Material Cost</p>
          <p className="font-semibold">{cost.material_cost.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-app p-3">
          <p className="text-muted">Std / Unit</p>
          <p className="font-semibold">{cost.standard_unit_cost.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-app p-3">
          <p className="text-muted">Actual / Unit</p>
          <p className="font-semibold">{cost.actual_unit_cost.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-app p-3">
          <p className="text-muted">Variance</p>
          <p className={`font-semibold ${cost.variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{cost.variance >= 0 ? "+" : ""}{cost.variance.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

function GenealogySection({ genealogy, woNumber }: { genealogy: WorkOrderGenealogy | undefined; woNumber: string }) {
  if (!genealogy || (genealogy.component_lots.length === 0 && genealogy.fg_lots.length === 0)) {
    return (
      <div className="text-sm text-faint">
        Lot genealogy unavailable — complete this work order with an FG lot number to record traceability links.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-ink">Lot Genealogy</h4>
      {genealogy.fg_lots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {genealogy.fg_lots.map((l) => (
            <span key={l.lot_id} className="badge badge-success border border-green-200 dark:border-green-500/30">
              FG: {l.lot_number} ({l.product_name} × {l.quantity})
            </span>
          ))}
        </div>
      )}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-2 font-medium text-muted">Consumed Lot</th>
              <th className="px-4 py-2 font-medium text-muted">Product</th>
              <th className="px-4 py-2 font-medium text-muted">Qty</th>
              <th className="px-4 py-2 font-medium text-muted">Produced Lot</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {genealogy.links.map((link, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-medium">{link.parent_lot_number}</td>
                <td className="px-4 py-2 text-muted">{genealogy.component_lots.find((c) => c.lot_id === link.parent_lot_id)?.product_name || "—"}</td>
                <td className="px-4 py-2">{link.quantity}</td>
                <td className="px-4 py-2">{link.child_lot_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {genealogy.links.length === 0 && (
        <p className="text-sm text-muted">Completed with FG lot {genealogy.fg_lots[0]?.lot_number} but no component lots were consumed (manual issue without lot assignment).</p>
      )}
      <p className="text-xs text-faint">Shows which source lots were consumed by {woNumber} to produce the finished-good lot.</p>
    </div>
  );
}

function CompleteModal({ wo, onClose, onSaved }: { wo: WorkOrder; onClose: () => void; onSaved: () => void }) {
  const [receivedQty, setReceivedQty] = useState(String(wo.quantity));
  const [receiveLocationId, setReceiveLocationId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [serials, setSerials] = useState("");
  const [backflush, setBackflush] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } }).then(({ data }) => setLocations(data.items));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveLocationId) {
      addToast("Select a receive location", "error");
      return;
    }
    const serialList = serials.split("\n").map((s) => s.trim()).filter(Boolean);
    if (wo.is_serialized) {
      const qty = parseInt(receivedQty) || wo.quantity;
      if (serialList.length !== qty) {
        addToast(`Enter exactly ${qty} serial number(s), one per line`, "error");
        return;
      }
    }
    setSaving(true);
    try {
      await api.post(`/work-orders/${wo.id}/complete`, {
        received_qty: parseInt(receivedQty) || wo.quantity,
        receive_location_id: Number(receiveLocationId),
        lot_number: lotNumber.trim() || undefined,
        backflush,
        serial_numbers: serialList,
      });
      addToast(`${wo.wo_number} completed`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error completing work order", "error");
    }
    setSaving(false);
  };

  const needsBackflush = wo.items.some((i) => i.quantity_issued < i.quantity_required);

  return (
    <Modal open onClose={onClose} title={`Complete ${wo.wo_number}`} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Received Qty</label>
            <input type="number" min={1} className="input" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} disabled={wo.is_serialized} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Receive Location</label>
            <select className="select" value={receiveLocationId} onChange={(e) => setReceiveLocationId(e.target.value)} required>
              <option value="">Select location...</option>
              {locations.filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path)).map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
        </div>
        {wo.is_serialized ? (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Serial Numbers ({wo.quantity} required, one per line)</label>
            <textarea className="input" rows={Math.max(3, wo.quantity)} value={serials} onChange={(e) => setSerials(e.target.value)} placeholder={"SN-0001\nSN-0002"} />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-ink mb-1">FG Lot Number (optional)</label>
            <input className="input" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="e.g. FG-0001" />
          </div>
        )}
        {needsBackflush && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="rounded" checked={backflush} onChange={(e) => setBackflush(e.target.checked)} />
            Backflush remaining components ({wo.total_required - wo.total_issued} units still needed)
          </label>
        )}
        <p className="text-xs text-muted">
          {wo.is_serialized
            ? "Each serial number registers one finished unit, enabling serial-level traceability back to consumed lots."
            : "Receiving creates a finished-good stock entry; a supplied lot number enables lot traceability."}
        </p>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !receiveLocationId} className="btn-primary">{saving ? "Completing..." : "Complete WO"}</button>
        </div>
      </form>
    </Modal>
  );
}
