import { useDateFormat } from "../hooks/useDateFormat";
import { statusBadge } from "../utils/statusBadges";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, PackagePlus, Pencil, Plus, Printer, Search, Trash2, Truck, XCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PICKER } from "../utils/constants";
import type { ASN, LPN, PaginatedResponse, Product, Supplier } from "../types";
import Modal from "../components/Modal";
import SlideOver from "../components/SlideOver";
import AttachmentSection from "../components/AttachmentSection";
import LocationPicker from "../components/LocationPicker";
import StockLocationHints from "../components/StockLocationHints";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ProgressBar from "../components/ProgressBar";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDebounce } from "../hooks/useDebounce";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { daysUntil } from "../utils/date";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import FittedSelect from "../components/FittedSelect";

function supplierSelectableItems(items: Product[], supplierId: string): Product[] {
  const sid = Number(supplierId);
  const out: Product[] = [];
  for (const p of items) {
    const variants = (p.variants || []).filter((v) => v.is_active);
    if (variants.length > 0) {
      const parentBelongs = p.supplier_id === sid;
      const inSupplier = variants.filter(
        (v) => v.supplier_id === sid || (v.supplier_id === null && parentBelongs)
      );
      if (inSupplier.length > 0) out.push(...inSupplier);
    } else if (p.is_active && p.supplier_id === sid) {
      out.push(p);
    }
  }
  return out;
}

export default function ASNs() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [status, setStatus] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [viewing, setViewing] = useState<ASN | null>(null);
  const [receiving, setReceiving] = useState<ASN | null>(null);
  const [cancelling, setCancelling] = useState<ASN | null>(null);
  const [deleting, setDeleting] = useState<ASN | null>(null);
  const [editing, setEditing] = useState<ASN | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.put(`/asns/${id}`, { status: "cancelled" }),
    onSuccess: () => {
      addToast("ASN cancelled", "success");
      queryClient.invalidateQueries({ queryKey: ["asns"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Error cancelling ASN"), "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/asns/${id}`),
    onSuccess: () => {
      addToast("ASN deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["asns"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Error deleting ASN"), "error");
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-lookup"],
    queryFn: async () => { const { data } = await api.get("/suppliers", { params: { limit: 500 } }); return (data.items || data) as Supplier[]; },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["asns", debouncedSearch, status, supplierFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      if (supplierFilter) params.supplier_id = supplierFilter;
      const { data } = await api.get("/asns", { params });
      return data as PaginatedResponse<ASN>;
    },
  });

  const asns = data?.items || [];

  const printPdf = async (a: ASN) => {
    try {
      const { data } = await api.get(`/asns/${a.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  const arrivalBadge = (date: string | null) => {
    if (!date) return <span className="text-muted">—</span>;
    const days = daysUntil(date);
    if (days < 0) return <span className="badge badge-danger">Overdue {formatDate(date)}</span>;
    if (days <= 3) return <span className="badge badge-warning">Due {formatDate(date)}</span>;
    return <span className="text-muted text-xs">{formatDate(date)}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Truck size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">ASNs</h1>
            <p className="text-sm text-muted mt-1">Advanced shipping notices — track incoming supplier shipments from order to dock.</p>
          </div>
        </div>
        {can("asns.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-1">
            <PackagePlus size={16} /> New ASN
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load ASNs")}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by ASN number, supplier..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search ASNs" />
        </div>
        <FittedSelect
          ariaLabel="Filter by status"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: "", label: "All Statuses" },
            { value: "pending", label: "Pending" },
            { value: "cancelled", label: "Cancelled" },
            { value: "received", label: "Received" },
          ]}
        />
        <FittedSelect
          ariaLabel="Filter by supplier"
          value={supplierFilter}
          onChange={(v) => { setSupplierFilter(v); setPage(1); }}
          options={[{ value: "", label: "All Suppliers" }, ...suppliers.map((s) => ({ value: String(s.id), label: s.name }))]}
        />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="ASNs table">
          <thead>
            <tr className="bg-subtle text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted">ASN #</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Supplier</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Expected Arrival</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Progress</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={6} />
            ) : asns.length === 0 ? (
              <EmptyState title="No ASNs yet" message="Create an advance shipping notice for incoming supplier shipments." actionLabel="New ASN" onAction={() => setShowForm(true)} />
            ) : asns.map((a) => (
              <tr key={a.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(a)}>
                <td className="px-4 py-3 font-medium">{a.asn_number}</td>
                <td className="px-4 py-3 text-muted">{a.supplier_name || "—"}</td>
                <td className="px-4 py-3">{arrivalBadge(a.expected_arrival)}</td>
                <td className="px-4 py-3 whitespace-nowrap"><span className={`badge ${statusBadge(a.status)}`}>{a.status.replace("_", " ")}</span></td>
                <td className="px-4 py-3">
                  <ProgressBar value={a.total_received} max={a.total_expected} label={`Receive progress for ${a.asn_number}`} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); printPdf(a); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Print ${a.asn_number}`}><Printer size={16} /></button>
                    <button onClick={(e) => { e.stopPropagation(); setViewing(a); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View ${a.asn_number}`}><Eye size={16} /></button>
                    {can("asns.update") && (
                      <button onClick={(e) => { e.stopPropagation(); setEditing(a); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${a.asn_number}`} title="Edit ASN">
                        <Pencil size={16} />
                      </button>
                    )}
                    {a.status === "pending" && can("asns.receive") && (
                      <button onClick={(e) => { e.stopPropagation(); setReceiving(a); }} className="text-xs text-primary dark:text-primary hover:text-primary-strong dark:text-primary font-medium">Receive</button>
                    )}
                    {a.status === "pending" && a.total_received === 0 && can("asns.update") && (
                      <button onClick={(e) => { e.stopPropagation(); setCancelling(a); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Cancel ${a.asn_number}`} title="Cancel ASN">
                        <XCircle size={16} />
                      </button>
                    )}
                    {a.status === "pending" && a.total_received === 0 && can("asns.update") && (
                      <button onClick={(e) => { e.stopPropagation(); setDeleting(a); }} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${a.asn_number}`} title="Delete ASN">
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

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {showForm && (
        <AsnForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["asns"] }); }} />
      )}

      {editing && (
        <AsnEditModal
          asn={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            if (viewing?.id === editing.id) setViewing(null);
            queryClient.invalidateQueries({ queryKey: ["asns"] });
          }}
        />
      )}

      {viewing && <AsnDetail asn={viewing} onClose={() => setViewing(null)} />}

      {receiving && (
        <AsnReceiveModal
          asn={receiving}
          onClose={() => setReceiving(null)}
          onSaved={() => { setReceiving(null); queryClient.invalidateQueries({ queryKey: ["asns"] }); queryClient.invalidateQueries({ queryKey: ["receipts"] }); queryClient.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}

      <ConfirmDialog
        open={!!cancelling}
        title="Cancel ASN"
        message={`Are you sure you want to cancel ASN "${cancelling?.asn_number}"? This cannot be undone.`}
        confirmLabel="Cancel ASN"
        confirmClass="btn-danger"
        onConfirm={() => { if (cancelling) cancelMutation.mutate(cancelling.id); setCancelling(null); }}
        onCancel={() => setCancelling(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete ASN"
        message={`Are you sure you want to permanently delete ASN "${deleting?.asn_number}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmClass="btn-danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

interface AsnFormRowData {
  product_id: string;
  expected_qty: string;
  unit_cost: string;
  location: string;
}

function AsnFormRow({ row, idx, productList, onChange, onRemove }: {
  row: AsnFormRowData;
  idx: number;
  productList: Product[];
  onChange: (idx: number, key: keyof AsnFormRowData, value: string) => void;
  onRemove: (idx: number) => void;
}) {
  const product = productList.find((x) => x.id.toString() === row.product_id);
  const { locations: stockLocations, isLoading: stockLoading } = useProductStockLocations(
    product?.id,
    !!product?.is_serialized
  );

  useEffect(() => {
    if (!product || row.location) return;
    if (stockLocations.length === 1) {
      onChange(idx, "location", stockLocations[0].path);
    }
  }, [stockLocations]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
      <div className="sm:col-span-4">
        <label className="block text-xs font-medium text-muted mb-1">Product</label>
        <FittedSelect
          ariaLabel="Product"
          value={row.product_id}
          onChange={(v) => onChange(idx, "product_id", v)}
          options={[
            { value: "", label: "Select..." },
            ...productList.map((p) => ({ value: String(p.id), label: productLabel(p) })),
          ]}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-muted mb-1">Expected Qty</label>
        <input type="number" min={1} className="input" value={row.expected_qty} onChange={(e) => onChange(idx, "expected_qty", e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-muted mb-1">Unit Cost</label>
        <input type="number" step="0.01" min={0} className="input" value={row.unit_cost} onChange={(e) => onChange(idx, "unit_cost", e.target.value)} />
      </div>
      <div className="sm:col-span-3">
        <label className="block text-xs font-medium text-muted mb-1">Location</label>
        <LocationPicker value={row.location} onChange={(v) => onChange(idx, "location", v)} />
        {product && (
          <StockLocationHints
            locations={stockLocations}
            isSerialized={!!product.is_serialized}
            selectedPath={row.location}
            onSelect={(path) => onChange(idx, "location", path)}
            isLoading={stockLoading}
          />
        )}
      </div>
      <div className="sm:col-span-1 flex justify-end">
        <button type="button" onClick={() => onRemove(idx)} aria-label={`Remove item ${idx + 1}`} title="Remove item"
          className="text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors p-1">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function AsnForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [supplier_id, setSupplierId] = useState("");
  const [expected_arrival, setExpectedArrival] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AsnFormRowData[]>([{ product_id: "", expected_qty: "1", unit_cost: "0", location: "" }]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const productList = useSelectableProducts();

  const { data: suppliers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["suppliers", "picker"],
    queryFn: async () => (await api.get("/suppliers", { params: { limit: PAGE_SIZE_PICKER } })).data.items,
  });

  const { data: locations = [] } = useQuery<{ id: number; path: string }[]>({
    queryKey: ["locations", "lookup"],
    queryFn: async () => (await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } })).data.items,
  });

  const { data: rawSupplierProducts, isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ["supplier-products", supplier_id],
    queryFn: async () => (await api.get(`/suppliers/${supplier_id}/products`, { params: { limit: 100 } })).data.items,
    enabled: !!supplier_id,
  });

  const supplierProducts = useMemo(() => {
    if (!rawSupplierProducts || !supplier_id) return [];
    return supplierSelectableItems(rawSupplierProducts, supplier_id);
  }, [rawSupplierProducts, supplier_id]);

  const toastedSupplierRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supplier_id || !rawSupplierProducts) return;
    if (toastedSupplierRef.current === supplier_id) return;
    toastedSupplierRef.current = supplier_id;
    const supplierName = suppliers.find((s) => s.id.toString() === supplier_id)?.name ?? "this supplier";
    if (supplierProducts.length > 0) {
      addToast(`${supplierName}: ${supplierProducts.length} linked product(s) available in the list`, "info");
    } else {
      addToast(`${supplierName} has no linked products - add items manually`, "info");
    }
  }, [supplier_id, rawSupplierProducts]);

  const selectableProducts = useMemo(() => {
    if (!supplier_id) return productList;
    const selectedIds = new Set(rows.filter((r) => r.product_id).map((r) => r.product_id));
    const extra = productList.filter((p) => selectedIds.has(p.id.toString()) && !supplierProducts.some((sp) => sp.id === p.id));
    return [...supplierProducts, ...extra];
  }, [supplier_id, supplierProducts, productList, rows]);

  const setRow = (idx: number, key: keyof AsnFormRowData, value: string) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      if (key === "product_id") {
        const p = selectableProducts.find((x) => x.id.toString() === value);
        return {
          ...r,
          product_id: value,
          unit_cost: p ? String(p.cost_price ?? 0) : r.unit_cost,
          location: "",
        };
      }
      return { ...r, [key]: value };
    }));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => {
      if (prev.length === 1) {
        return [{ product_id: "", expected_qty: "1", unit_cost: "0", location: "" }];
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows.filter((r) => r.product_id).map((r) => {
      const loc = r.location.trim();
      const locMatch = loc ? locations.find((l) => l.path === loc) : undefined;
      return {
        product_id: Number(r.product_id),
        expected_qty: parseInt(r.expected_qty) || 1,
        unit_cost: parseFloat(r.unit_cost) || 0,
        location_id: loc ? locMatch?.id ?? -1 : null,
      };
    });
    if (items.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    if (items.some((i) => i.location_id === -1)) {
      addToast("Unknown location - pick a location from the dropdown", "error");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/asns", {
        supplier_id: supplier_id ? Number(supplier_id) : null,
        expected_arrival: expected_arrival || null,
        notes: notes.trim(),
        items,
      });
      addToast(`ASN ${data.asn_number} created`, "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error creating ASN"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="New ASN" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
            <FittedSelect
              ariaLabel="Supplier"
              value={supplier_id}
              onChange={setSupplierId}
              options={[
                { value: "", label: "None" },
                ...suppliers.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Expected Arrival</label>
            <input type="date" className="input" value={expected_arrival} onChange={(e) => setExpectedArrival(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-app px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Expected Items</span>
            <div className="flex items-center gap-3">
              {loadingProducts && <Skeleton variant="text" className="w-28 h-4" />}
              <button type="button" onClick={() => setRows([...rows, { product_id: "", expected_qty: "1", unit_cost: "0", location: "" }])} className="btn-secondary text-xs py-1 px-2">
                <Plus size={14} className="inline mr-1" />Add Item
              </button>
            </div>
          </div>
          <div className="divide-y divide-border max-h-[40vh] overflow-auto">
            {rows.map((row, idx) => (
              <AsnFormRow key={idx} row={row} idx={idx} productList={selectableProducts} onChange={setRow} onRemove={removeRow} />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Creating..." : "Create ASN"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AsnDetail({ asn, onClose }: { asn: ASN; onClose: () => void }) {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const { can } = useAuth();
  const currencySymbol = settings?.currency_symbol || "$";
  const totalAmount = asn.items.reduce((sum, i) => sum + i.unit_cost * i.expected_qty, 0);
  return (
    <SlideOver open onClose={onClose} title={`ASN ${asn.asn_number}`} wide>
      <div className="space-y-5">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">Advance Shipping Notice</p>
              <h3 className="text-2xl font-bold text-ink mt-1 tracking-tight">{asn.asn_number}</h3>
              <div className="mt-2"><span className={`badge ${statusBadge(asn.status)}`}>{asn.status.replace("_", " ")}</span></div>
            </div>
            <div className="text-right text-sm">
              <p className="text-muted">Expected Arrival</p>
              <p className="font-medium text-ink">{asn.expected_arrival ? formatDate(asn.expected_arrival) : "—"}</p>
              {asn.username && (
                <p className="text-muted mt-2">Created by <span className="font-medium text-ink">{asn.username}</span></p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 px-6 py-5 text-sm border-b border-dashed border-border">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Supplier</p>
              <p className="font-medium text-ink">{asn.supplier_name || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Expected Qty</p>
              <p className="font-medium text-ink">{asn.total_expected}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Received Qty</p>
              <p className="font-medium text-ink">{asn.total_received}</p>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-faint border-b border-border">
                    <th className="py-2.5 pr-3 text-left font-medium">Product</th>
                    <th className="py-2.5 px-3 text-left font-medium">Location</th>
                    <th className="py-2.5 px-3 text-center font-medium">Expected</th>
                    <th className="py-2.5 px-3 text-center font-medium">Received</th>
                    <th className="py-2.5 px-3 text-right font-medium">Unit Cost</th>
                    <th className="py-2.5 px-3 text-right font-medium">Amount</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {asn.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 pr-3 font-medium text-ink">{item.product_name}</td>
                      <td className="py-3 px-3 text-muted whitespace-nowrap">{item.location_name || "—"}</td>
                      <td className="py-3 px-3 text-center text-muted whitespace-nowrap">{item.expected_qty}</td>
                      <td className="py-3 px-3 text-center text-muted whitespace-nowrap">{item.received_qty}</td>
                      <td className="py-3 px-3 text-right text-muted whitespace-nowrap">{formatCurrency(item.unit_cost, currencySymbol)}</td>
                      <td className="py-3 px-3 text-right text-ink font-medium whitespace-nowrap">{formatCurrency(item.unit_cost * item.expected_qty, currencySymbol)}</td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <span className={`badge ${statusBadge(item.status)}`}>{item.status.replace("_", " ")}</span>
                      </td>
                    </tr>
                  ))}
                  {asn.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted">No items on this shipment</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-5 border-t-2 border-double border-border pt-4 flex items-start justify-between gap-3">
              <div className="text-sm text-muted">
                Received <span className="font-semibold text-ink">{asn.total_received}</span> of {asn.total_expected} expected
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-faint">Total Value</p>
                <p className="text-2xl font-bold text-ink">{formatCurrency(totalAmount, currencySymbol)}</p>
              </div>
            </div>
          </div>

          {asn.notes && (
            <div className="px-6 pb-5 text-sm">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted">{asn.notes}</p>
            </div>
          )}
        </div>
        <div className="px-6 py-5 border-t border-border bg-white dark:bg-app">
          <AttachmentSection entityType="asn" entityId={asn.id} canEdit={can("asns.create")} />
        </div>
      </div>
    </SlideOver>
  );
}

function AsnEditModal({ asn, onClose, onSaved }: { asn: ASN; onClose: () => void; onSaved: () => void }) {
  const [expected_arrival, setExpectedArrival] = useState(asn.expected_arrival?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(asn.notes);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/asns/${asn.id}`, {
        expected_arrival: expected_arrival || null,
        notes: notes.trim(),
      });
      addToast(`ASN ${asn.asn_number} updated`, "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error updating ASN"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${asn.asn_number}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Expected Arrival</label>
          <input type="date" className="input" aria-label="Expected Arrival" value={expected_arrival} onChange={(e) => setExpectedArrival(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={3} aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

interface AsnRowData {
  product_id: number;
  product_name: string;
  received_qty: string;
  lot_number: string;
  expiry_date: string;
  location: string;
  lpn_number: string;
  serial_numbers: string;
}

function useLocationLpns(locationPath: string, locations: { id: number; path: string }[]) {
  const locationId = useMemo(() => {
    if (!locationPath) return undefined;
    return locations.find((l) => l.path === locationPath)?.id;
  }, [locationPath, locations]);

  const { data, isLoading } = useQuery({
    queryKey: ["lpns", "by-location", locationId],
    queryFn: async () => {
      const { data } = await api.get("/lpns", { params: { location_id: locationId, limit: PAGE_SIZE_PICKER } });
      return data.items as LPN[];
    },
    enabled: !!locationId,
  });
  return { lpns: data ?? [], isLoading };
}

function AsnReceiveRow({ row, idx, productList, locations, onChange }: {
  row: AsnRowData;
  idx: number;
  productList: Product[];
  locations: { id: number; path: string }[];
  onChange: (idx: number, key: keyof AsnRowData, value: string) => void;
}) {
  const product = productList.find((p) => p.id === row.product_id);
  const { locations: stockLocations, isLoading: stockLoading } = useProductStockLocations(
    product?.id,
    !!product?.is_serialized
  );
  const { lpns, isLoading: lpnsLoading } = useLocationLpns(row.location, locations);

  useEffect(() => {
    if (!product || row.location) return;
    if (stockLocations.length === 1) {
      onChange(idx, "location", stockLocations[0].path);
    }
  }, [stockLocations]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!row.location || row.lpn_number) return;
    if (lpns.length === 1) {
      onChange(idx, "lpn_number", lpns[0].lpn_number);
    }
  }, [lpns]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLocationChange = (v: string) => {
    onChange(idx, "location", v);
    onChange(idx, "lpn_number", "");
  };

  return (
    <div className="p-4 space-y-2">
      <p className="text-sm font-medium">{row.product_name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Qty Received</label>
          <input type="number" min={1} className="input" value={row.received_qty} onChange={(e) => onChange(idx, "received_qty", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Lot #</label>
          <input className="input" value={row.lot_number} onChange={(e) => onChange(idx, "lot_number", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Expiry</label>
          <input type="date" className="input" value={row.expiry_date} onChange={(e) => onChange(idx, "expiry_date", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Location</label>
          <LocationPicker value={row.location} onChange={handleLocationChange} />
          {product && (
            <StockLocationHints
              locations={stockLocations}
              isSerialized={!!product.is_serialized}
              selectedPath={row.location}
              onSelect={handleLocationChange}
              isLoading={stockLoading}
            />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">LPN (pallet)</label>
          <input className="input" list={`asn-lpn-options-${idx}`} placeholder="e.g. LPN-1001" aria-label="LPN number" value={row.lpn_number} onChange={(e) => onChange(idx, "lpn_number", e.target.value)} />
          <datalist id={`asn-lpn-options-${idx}`}>
            {lpns.map((l) => (
              <option key={l.id} value={l.lpn_number}>
                {l.content_count === 0 ? "empty pallet" : `${l.total_quantity} units`}
              </option>
            ))}
          </datalist>
          {lpnsLoading && <Skeleton variant="text" className="w-20 h-3 mt-1" />}
        </div>
      </div>
      {product?.is_serialized && (
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Serial numbers (one per line)</label>
          <textarea className="input font-mono text-xs" rows={2} value={row.serial_numbers} onChange={(e) => onChange(idx, "serial_numbers", e.target.value)} placeholder={"SN-001\nSN-002"} />
        </div>
      )}
    </div>
  );
}

function AsnReceiveModal({ asn, onClose, onSaved }: { asn: ASN; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<AsnRowData[]>(
    asn.items.filter((i) => i.received_qty < i.expected_qty).map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      received_qty: (i.expected_qty - i.received_qty).toString(),
      lot_number: "",
      expiry_date: "",
      location: "",
      lpn_number: "",
      serial_numbers: "",
    }))
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const productList = useSelectableProducts();
  const { data: locations = [] } = useQuery<{ id: number; path: string }[]>({
    queryKey: ["locations", "lookup"],
    queryFn: async () => (await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } })).data.items,
  });
  const { data: lpns = [] } = useQuery<{ id: number; lpn_number: string }[]>({
    queryKey: ["lpns", "picker"],
    queryFn: async () => (await api.get("/lpns", { params: { limit: PAGE_SIZE_PICKER } })).data.items,
  });

  const setRow = (idx: number, key: keyof AsnRowData, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows.map((r) => {
      const product = productList.find((p) => p.id === r.product_id);
      const loc = r.location.trim();
      const locMatch = loc ? locations.find((l) => l.path === loc) : undefined;
      const lpnNum = r.lpn_number.trim();
      const lpnMatch = lpnNum ? lpns.find((l) => l.lpn_number === lpnNum) : undefined;
      return {
        product_id: r.product_id,
        received_qty: parseInt(r.received_qty) || 0,
        lot_number: r.lot_number.trim(),
        expiry_date: r.expiry_date || null,
        location_id: loc ? locMatch?.id ?? -1 : null,
        lpn_id: lpnNum ? lpnMatch?.id ?? -1 : null,
        serial_numbers: product?.is_serialized
          ? r.serial_numbers.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
          : [],
      };
    }).filter((i) => i.received_qty > 0);
    if (items.length === 0) {
      addToast("Enter a quantity to receive", "error");
      return;
    }
    if (items.some((i) => i.location_id === -1)) {
      addToast("Unknown location - pick a location from the dropdown", "error");
      return;
    }
    if (items.some((i) => i.lpn_id === -1)) {
      addToast("Unknown LPN number - create the LPN first or clear the field", "error");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/asns/${asn.id}/receive`, { items, notes: notes.trim() });
      addToast(`ASN ${data.asn_number} updated`, "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error receiving ASN"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Receive ${asn.asn_number}`} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="divide-y divide-border max-h-[50vh] overflow-auto border border-border rounded-lg">
          {rows.map((row, idx) => (
            <AsnReceiveRow key={idx} row={row} idx={idx} productList={productList} locations={locations} onChange={setRow} />
          ))}
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Receiving..." : "Receive Stock"}</button>
        </div>
      </form>
    </Modal>
  );
}
