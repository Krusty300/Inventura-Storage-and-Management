import { useDateFormat } from "../hooks/useDateFormat";
import { statusBadge } from "../utils/statusBadges";
import { useEffect, useMemo, useState } from "react";
import { Eye, PackagePlus, Plus, Printer, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PICKER } from "../utils/constants";
import type { ASN, LPN, PaginatedResponse, Product } from "../types";
import Modal from "../components/Modal";
import LocationPicker from "../components/LocationPicker";
import StockLocationHints from "../components/StockLocationHints";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

import { usePageSize } from "../hooks/usePageSize";

function errorMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
  return fallback;
}

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
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [viewing, setViewing] = useState<ASN | null>(null);
  const [receiving, setReceiving] = useState<ASN | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["asns", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/asns", { params });
      return data as PaginatedResponse<ASN>;
    },
  });

  const asns = data?.items || [];

  const printPdf = async (a: ASN) => {
    try {
      const { data } = await api.get(`/asns/${a.id}/pdf`, { responseType: "blob" });
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
        <h1 className="text-2xl font-bold text-ink">ASNs</h1>
        {can("asns.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <PackagePlus size={16} className="inline mr-1" />New ASN
          </button>
        )}
      </div>

      {isError && (
        <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          Failed to load ASNs: {(error as any)?.message}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by ASN number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search ASNs" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="ASNs table">
          <thead>
            <tr className="bg-app text-left">
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
              <tr key={a.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{a.asn_number}</td>
                <td className="px-4 py-3 text-muted">{a.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-muted">{a.expected_arrival ? formatDate(a.expected_arrival) : "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(a.status)}`}>{a.status}</span></td>
                <td className="px-4 py-3 text-muted">{a.total_received}/{a.total_expected}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => printPdf(a)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Print ${a.asn_number}`}><Printer size={16} /></button>
                    <button onClick={() => setViewing(a)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${a.asn_number}`}><Eye size={16} /></button>
                    {a.status === "pending" && can("asns.receive") && (
                      <button onClick={() => setReceiving(a)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400 font-medium">Receive</button>
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

      {viewing && <AsnDetail asn={viewing} onClose={() => setViewing(null)} />}

      {receiving && (
        <AsnReceiveModal
          asn={receiving}
          onClose={() => setReceiving(null)}
          onSaved={() => { setReceiving(null); queryClient.invalidateQueries({ queryKey: ["asns"] }); queryClient.invalidateQueries({ queryKey: ["receipts"] }); queryClient.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}
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
        <select className="select" aria-label="Product" value={row.product_id} onChange={(e) => onChange(idx, "product_id", e.target.value)}>
          <option value="">Select...</option>
          {productList.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
        </select>
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
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [supplierProducts, setSupplierProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<{ id: number; path: string }[]>([]);
  const { addToast } = useToast();
  const productList = useSelectableProducts();
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    api.get("/suppliers", { params: { limit: PAGE_SIZE_PICKER } }).then(({ data }) => setSuppliers(data.items));
    api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } }).then(({ data }) => setLocations(data.items));
  }, []);

  useEffect(() => {
    if (!supplier_id) {
      setSupplierProducts([]);
      return;
    }
    let cancelled = false;
    setLoadingProducts(true);
    const supplierName = suppliers.find((s) => s.id.toString() === supplier_id)?.name ?? "this supplier";
    api.get(`/suppliers/${supplier_id}/products`, { params: { limit: 100 } })
      .then(({ data }) => {
        if (cancelled) return;
        const items = supplierSelectableItems(data.items || [], supplier_id);
        setSupplierProducts(items);
        if (items.length > 0) {
          addToast(`${supplierName}: ${items.length} linked product(s) available in the list`, "info");
        } else {
          addToast(`${supplierName} has no linked products - add items manually`, "info");
        }
      })
      .catch(() => { if (!cancelled) addToast("Could not load supplier products", "error"); })
      .finally(() => { if (!cancelled) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, [supplier_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch (err: any) {
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
            <select className="select" aria-label="Supplier" value={supplier_id} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
              {loadingProducts && <span className="text-xs text-muted">Loading supplier products...</span>}
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
  return (
    <Modal open onClose={onClose} title={`ASN ${asn.asn_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted">Supplier</p>
            <p className="font-medium">{asn.supplier_name || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Expected Arrival</p>
            <p className="font-medium">{asn.expected_arrival ? formatDate(asn.expected_arrival) : "—"}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p className="font-medium capitalize">{asn.status}</p>
          </div>
        </div>
        {asn.notes && <p className="text-sm text-muted">{asn.notes}</p>}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Product</th>
                <th className="px-4 py-2 font-medium text-muted">Expected</th>
                <th className="px-4 py-2 font-medium text-muted">Received</th>
                <th className="px-4 py-2 font-medium text-muted">Unit Cost</th>
                <th className="px-4 py-2 font-medium text-muted">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {asn.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}</td>
                  <td className="px-4 py-2">{item.expected_qty}</td>
                  <td className="px-4 py-2">{item.received_qty}</td>
                  <td className="px-4 py-2">{item.unit_cost.toFixed(2)}</td>
                  <td className="px-4 py-2"><span className="badge badge-info">{item.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
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
          {lpnsLoading && <p className="text-xs text-faint mt-1">Loading LPNs...</p>}
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
  const [locations, setLocations] = useState<{ id: number; path: string }[]>([]);
  const [lpns, setLpns] = useState<{ id: number; lpn_number: string }[]>([]);

  useEffect(() => {
    api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } }).then(({ data }) => setLocations(data.items));
    api.get("/lpns", { params: { limit: PAGE_SIZE_PICKER } }).then(({ data }) => setLpns(data.items));
  }, []);

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
    } catch (err: any) {
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
