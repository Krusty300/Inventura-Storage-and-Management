import { useDateFormat } from "../hooks/useDateFormat";
import { statusBadge } from "../utils/statusBadges";
import { useEffect, useRef, useState } from "react";
import { Eye, Pencil, Trash2, XCircle, Search, Fingerprint, PackagePlus, FolderOpen, PackageOpen, PackageCheck, CheckCircle2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Customer, PaginatedResponse, Sale, SerialNumber, Shipment, ShipmentItem, ShipmentStats } from "../types";
import Modal from "../components/Modal";
import SlideOver from "../components/SlideOver";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import FittedSelect from "../components/FittedSelect";
import PaymentMethodPicker from "../components/PaymentMethodPicker";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { productLabel } from "../utils/variants";
import type { Product } from "../types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageSize } from "../hooks/usePageSize";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { MOBILE_MONEY_PROVIDERS, paymentLabel } from "../utils/payments";
import { errorMessage } from "../utils/errors";

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
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete shipment"), "error");
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
        { label: "Open", value: stats.open, icon: <FolderOpen size={18} />, theme: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" },
        { label: "Picking", value: stats.counts.picking ?? 0, icon: <PackageOpen size={18} />, theme: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
        { label: "Packed", value: stats.counts.packed ?? 0, icon: <PackageCheck size={18} />, theme: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" },
        { label: "Shipped", value: stats.counts.shipped ?? 0, icon: <CheckCircle2 size={18} />, theme: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <PackageOpen size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Shipments</h1>
            <p className="text-sm text-muted mt-1">Outbound orders moving through the pick, pack, and ship workflow.</p>
          </div>
        </div>
        {can("shipments.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-1">
            <PackagePlus size={16} /> New Shipment
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load shipments")}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by shipment number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search shipments" />
        </div>
        <FittedSelect ariaLabel="Filter by status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={[{ value: "", label: "All statuses" }, { value: "draft", label: "Draft" }, { value: "picking", label: "Picking" }, { value: "packed", label: "Packed" }, { value: "shipped", label: "Shipped" }, { value: "cancelled", label: "Cancelled" }]} />
      </div>

      {statCards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {statCards.map((c) => (
            <div key={c.label} className="card flex items-center gap-3 py-4 min-w-0">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.theme}`}>{c.icon}</span>
              <div className="min-w-0">
                <p className="text-[13px] text-muted truncate">{c.label}</p>
                <p className="text-xl font-bold text-ink truncate">{c.value}</p>
              </div>
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
                <tr className="bg-subtle text-left">
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Shipment</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Items</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Qty</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Invoice</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Created</th>
                  <th className="px-4 py-3 font-medium text-muted" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shipments.map((s) => (
                  <tr key={s.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(s)}>
                    <td className="px-4 py-3 font-medium">{s.shipment_number}</td>
                    <td className="px-4 py-3 text-muted">{s.customer_name || "—"}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusBadge(s.status)}`}>{s.status.replace("_", " ")}</span></td>
                    <td className="px-4 py-3">{s.items.length}</td>
                    <td className="px-4 py-3">{s.total_quantity}</td>
                    <td className="px-4 py-3 text-muted">{s.invoice_number || "—"}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(s.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={(e) => { e.stopPropagation(); setViewing(s); }} className="p-1 text-faint hover:text-primary dark:text-primary" title={`View ${s.shipment_number}`} aria-label={`View ${s.shipment_number}`}>
                          <Eye size={16} />
                        </button>
                        {s.status !== "shipped" && can("shipments.update") && (
                          <button onClick={(e) => { e.stopPropagation(); setEditing(s); }} className="p-1 text-faint hover:text-primary dark:text-primary" title={`Edit ${s.shipment_number}`} aria-label={`Edit ${s.shipment_number}`}>
                            <Pencil size={16} />
                          </button>
                        )}
                        {(s.status === "draft" || s.status === "cancelled") && can("shipments.delete") && (
                          <button onClick={(e) => { e.stopPropagation(); setDeleting(s); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${s.shipment_number}`}>
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
    } catch (err: unknown) {
      addToast(errorMessage(err, (isEdit ? "Error updating shipment" : "Error creating shipment")), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={isEdit ? `Edit ${shipment!.shipment_number}` : "New Shipment"} wide ariaLabel={isEdit ? `Edit ${shipment!.shipment_number}` : "New Shipment"}>
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
            <FittedSelect
              ariaLabel="Customer"
              value={customerId}
              onChange={setCustomerId}
              disabled={false}
              options={[
                { value: "", label: "No customer" },
                ...customers.map((c) => ({ value: String(c.id), label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}` })),
              ]}
            />
          </div>
        </div>

        {!isEdit && (
          <>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <ShipmentLineRow key={idx} index={idx} row={row} products={products} onChange={setRow} onRemove={(i) => setRows(rows.filter((_, n) => n !== i))} />
              ))}
            </div>
            <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1", location_id: "" }])} className="text-sm text-primary dark:text-primary hover:text-primary-strong dark:text-primary">
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
    </SlideOver>
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
    <div className="grid grid-cols-12 gap-3 sm:gap-4 items-end">
      <div className="col-span-12 sm:col-span-5">
        <label className="block text-sm font-medium text-ink mb-1.5">Product</label>
        <FittedSelect ariaLabel="Product" value={row.product_id} onChange={(v) => onChange(index, "product_id", v)} options={[{ value: "", label: "Select product..." }, ...products.sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: String(p.id), label: productLabel(p) }))]} />
      </div>
      <div className="col-span-4 sm:col-span-2">
        <label className="block text-sm font-medium text-ink mb-1.5">Qty</label>
        <input type="number" min={1} className="input w-full" value={row.quantity} onChange={(e) => onChange(index, "quantity", e.target.value)} />
      </div>
      <div className="col-span-8 sm:col-span-4">
        <label className="block text-sm font-medium text-ink mb-1.5">Source location</label>
        <FittedSelect value={row.location_id} onChange={(v) => onChange(index, "location_id", v)} ariaLabel="Source location" options={[{ value: "", label: "Any location (auto)" }, ...locations.map((l) => ({ value: String(l.location_id), label: `${l.path} (${l.count})` }))]} />
        {isLoading && <Skeleton variant="text" className="w-24 h-3 mt-1.5" />}
        {!isLoading && unallocated > 0 && (
          <p className="text-xs text-faint mt-1.5">
            Plus {unallocated} unallocated unit{unallocated === 1 ? "" : "s"} - pick with "Any location"
          </p>
        )}
      </div>
      <div className="col-span-4 sm:col-span-1 flex justify-end">
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
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const currencyCode = settings?.currency_code || "USD";
  const [carrier, setCarrier] = useState(shipment.carrier);
  const [tracking, setTracking] = useState(shipment.tracking_number);
  const [paymentMethod, setPaymentMethod] = useState(shipment.payment_method || "cash");
  const [paymentProvider, setPaymentProvider] = useState(shipment.payment_provider || MOBILE_MONEY_PROVIDERS[0].value);
  const [paymentPhone, setPaymentPhone] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentProviderAmount, setPaymentProviderAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pickingSerials, setPickingSerials] = useState(false);
  const prefillDone = useRef(false);
  const { addToast } = useToast();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (prefillDone.current || !shipment.customer_id || shipment.status !== "shipped") return;
    prefillDone.current = true;
    api.get("/sales", { params: { customer_id: shipment.customer_id, limit: 10 } })
      .then(({ data }) => {
        const last = (data.items || []).find((s: Sale) => s.payment_method === "mobile_money" && s.payment_provider);
        if (last?.payment_provider) setPaymentProvider(last.payment_provider);
      })
      .catch(() => {});
  }, [shipment.customer_id, shipment.status]);

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
    } catch (err: unknown) {
      addToast(errorMessage(err, "Action failed"), "error");
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
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error shipping"), "error");
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
      const { data } = await api.post(`/shipments/${current.id}/create-sale`, null, {
        params: {
          payment_method: paymentMethod,
          payment_provider: paymentMethod === "mobile_money" ? paymentProvider : null,
          payment_reference: paymentReference.trim() || null,
          payment_phone: paymentPhone.trim() || null,
          payment_provider_amount: paymentMethod === "mobile_money" && paymentProviderAmount ? paymentProviderAmount : null,
          currency: currencyCode,
          currency_symbol: currencySymbol,
        },
      });
      addToast(`Invoice ${data.invoice_number} created`, "success");
      refresh();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error creating invoice"), "error");
    }
    setBusy(null);
  };

  return (
    <SlideOver open onClose={onClose} title={current.shipment_number} wide ariaLabel="Shipment details">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-app p-4 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div><p className="text-xs text-muted">Status</p><p className="font-medium mt-0.5"><span className={`badge ${statusBadge(current.status)}`}>{current.status.replace("_", " ")}</span></p></div>
            <div><p className="text-xs text-muted">Customer</p><p className="font-medium mt-0.5 truncate">{current.customer_name || "—"}</p></div>
            <div>
              <p className="text-xs text-muted">Carrier</p>
              <p className="font-medium mt-0.5">
                {current.carrier ? <span className="badge badge-info">{current.carrier}</span> : <span className="text-muted">—</span>}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Tracking</p>
              <p className="font-medium mt-0.5">
                {current.tracking_number ? <span className="badge bg-subtle text-ink border border-border font-mono">{current.tracking_number}</span> : <span className="text-muted">—</span>}
              </p>
            </div>
            <div><p className="text-xs text-muted">Invoice</p><p className="font-medium mt-0.5">{current.invoice_number || "—"}</p></div>
            <div><p className="text-xs text-muted">Payment</p><p className="font-medium mt-0.5">{paymentLabel(current.payment_method, current.payment_provider) || "—"}</p></div>
            <div><p className="text-xs text-muted">Amount</p><p className="font-medium mt-0.5">{current.total_amount ? formatCurrency(current.total_amount, currencySymbol) : "—"}</p></div>
            <div><p className="text-xs text-muted">Created By</p><p className="font-medium mt-0.5">{current.username}</p></div>
            <div><p className="text-xs text-muted">Created</p><p className="font-medium mt-0.5">{formatDate(current.created_at)}</p></div>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-subtle text-left">
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
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/30">
                          <Fingerprint size={12} />
                          serialized
                        </span>
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
            <div className="ml-auto flex flex-wrap gap-2">
              {canPick && (
                <button onClick={handlePick} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1 flex-1 sm:flex-none">
                  <PackageOpen size={16} />Pick
                </button>
              )}
              {canPack && (
                <button onClick={() => run("pack", `/shipments/${current.id}/pack`, "Packed")} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1 flex-1 sm:flex-none">
                  <PackageCheck size={16} />Pack
                </button>
              )}
              {canShip && (
                <button onClick={ship} disabled={busy !== null} className="btn-primary inline-flex items-center gap-1 flex-1 sm:flex-none">
                  <PackagePlus size={16} />Product Shipping
                </button>
              )}
            </div>
          </div>
        )}
        {canCreateSale && (
          <div className="flex items-end gap-3 justify-end flex-wrap">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Payment Method</label>
              <PaymentMethodPicker
                method={paymentMethod}
                provider={paymentProvider}
                onSelect={(m, p) => { setPaymentMethod(m); setPaymentProvider(p ?? MOBILE_MONEY_PROVIDERS[0].value); }}
              />
            </div>
            {paymentMethod === "mobile_money" && (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Payer Phone</label>
                <input className="input" placeholder="e.g. 07XX XXX XXX" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} aria-label="Payer phone" />
              </div>
            )}
            {paymentMethod === "mobile_money" && (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Provider Amount ({currencySymbol})</label>
                <input className="input" type="number" min="0" step="0.01" placeholder={current.total_amount?.toFixed(2) || ""} value={paymentProviderAmount} onChange={(e) => setPaymentProviderAmount(e.target.value)} aria-label="Provider amount" />
              </div>
            )}
            {paymentMethod !== "cash" && (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Payment Reference</label>
                <input className="input" placeholder={paymentMethod === "mobile_money" ? "Provider confirmation code" : "Reference (optional)"} value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} aria-label="Payment reference" />
              </div>
            )}
            <button onClick={createSale} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1 flex-1 sm:flex-none">
              <CheckCircle2 size={16} />Create Invoice
            </button>
          </div>
        )}
        {current.status !== "shipped" && current.status !== "cancelled" && canCancel && (
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => run("cancel", `/shipments/${current.id}/cancel`, "Cancelled")} disabled={busy !== null} className="btn-danger inline-flex items-center gap-1 flex-1 sm:flex-none">
              <XCircle size={16} />Cancel Shipment
            </button>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1 sm:flex-none">Close</button>
        </div>
      </div>
      {pickingSerials && (
        <PickSerialsModal
          shipment={current}
          onClose={() => setPickingSerials(false)}
          onPicked={() => { setPickingSerials(false); refresh(); }}
        />
      )}
    </SlideOver>
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
                  className="accent-primary"
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
              className="text-xs text-primary dark:text-primary hover:underline"
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
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error picking shipment"), "error");
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
