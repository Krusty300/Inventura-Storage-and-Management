import { useEffect, useState } from "react";
import { Eye, PackagePlus, Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { ASN, PaginatedResponse } from "../types";
import Modal from "../components/Modal";
import LocationPicker from "../components/LocationPicker";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 25;

export default function ASNs() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<ASN | null>(null);
  const [receiving, setReceiving] = useState<ASN | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["asns", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/asns", { params });
      return data as PaginatedResponse<ASN>;
    },
  });

  const asns = data?.items || [];

  const statusBadge = (s: string) =>
    s === "pending" ? "badge-info" : s === "received" ? "badge-success" : "badge-danger";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">ASNs</h1>
        {can("asns.create") && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <PackagePlus size={16} className="inline mr-1" />New ASN
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by ASN number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search ASNs" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="ASNs table">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">ASN #</th>
              <th className="px-4 py-3 font-medium text-gray-600">Supplier</th>
              <th className="px-4 py-3 font-medium text-gray-600">Expected Arrival</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 font-medium text-gray-600">Progress</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <Skeleton rows={5} cols={6} />
            ) : asns.length === 0 ? (
              <EmptyState title="No ASNs yet" message="Create an advance shipping notice for incoming supplier shipments." actionLabel="New ASN" onAction={() => setShowForm(true)} />
            ) : asns.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{a.asn_number}</td>
                <td className="px-4 py-3 text-gray-500">{a.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{a.expected_arrival ? new Date(a.expected_arrival).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(a.status)}`}>{a.status}</span></td>
                <td className="px-4 py-3 text-gray-500">{a.total_received}/{a.total_expected}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(a)} className="p-1 text-gray-400 hover:text-indigo-600" aria-label={`View ${a.asn_number}`}><Eye size={16} /></button>
                    {a.status === "pending" && can("asns.receive") && (
                      <button onClick={() => setReceiving(a)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Receive</button>
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

function AsnForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [supplier_id, setSupplierId] = useState("");
  const [expected_arrival, setExpectedArrival] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState([{ product_id: "", expected_qty: "1", unit_cost: "0", location: "" }]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const productList = useSelectableProducts();
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    api.get("/suppliers", { params: { limit: 500 } }).then(({ data }) => setSuppliers(data.items));
  }, []);

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows.filter((r) => r.product_id).map((r) => ({
      product_id: Number(r.product_id),
      expected_qty: parseInt(r.expected_qty) || 1,
      unit_cost: parseFloat(r.unit_cost) || 0,
      location: r.location.trim(),
    }));
    if (items.length === 0) {
      addToast("Add at least one item", "error");
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
      addToast(err.response?.data?.detail || "Error creating ASN", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="New ASN" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
            <select className="select" value={supplier_id} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expected Arrival</label>
            <input type="date" className="input" value={expected_arrival} onChange={(e) => setExpectedArrival(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Expected Items</span>
            <button type="button" onClick={() => setRows([...rows, { product_id: "", expected_qty: "1", unit_cost: "0", location: "" }])} className="btn-secondary text-xs py-1 px-2">
              <Plus size={14} className="inline mr-1" />Add Item
            </button>
          </div>
          <div className="divide-y divide-gray-100 max-h-[40vh] overflow-auto">
            {rows.map((row, idx) => (
              <div key={idx} className="p-4 grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
                  <select className="select" value={row.product_id} onChange={(e) => setRow(idx, "product_id", e.target.value)}>
                    <option value="">Select...</option>
                    {productList.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expected Qty</label>
                  <input type="number" min={1} className="input" value={row.expected_qty} onChange={(e) => setRow(idx, "expected_qty", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Unit Cost</label>
                  <input type="number" step="0.01" min={0} className="input" value={row.unit_cost} onChange={(e) => setRow(idx, "unit_cost", e.target.value)} />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                  <LocationPicker value={row.location} onChange={(v) => setRow(idx, "location", v)} />
                </div>
              </div>
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
  return (
    <Modal open onClose={onClose} title={`ASN ${asn.asn_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Supplier</p>
            <p className="font-medium">{asn.supplier_name || "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Expected Arrival</p>
            <p className="font-medium">{asn.expected_arrival ? new Date(asn.expected_arrival).toLocaleDateString() : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className="font-medium capitalize">{asn.status}</p>
          </div>
        </div>
        {asn.notes && <p className="text-sm text-gray-600">{asn.notes}</p>}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Product</th>
                <th className="px-4 py-2 font-medium text-gray-600">Expected</th>
                <th className="px-4 py-2 font-medium text-gray-600">Received</th>
                <th className="px-4 py-2 font-medium text-gray-600">Unit Cost</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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

function AsnReceiveModal({ asn, onClose, onSaved }: { asn: ASN; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(
    asn.items.filter((i) => i.received_qty < i.expected_qty).map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      received_qty: (i.expected_qty - i.received_qty).toString(),
      lot_number: "",
      expiry_date: "",
      location: "",
      serial_numbers: "",
    }))
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const productList = useSelectableProducts();
  const [locations, setLocations] = useState<{ id: number; path: string }[]>([]);

  useEffect(() => {
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
  }, []);

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows.map((r) => {
      const product = productList.find((p) => p.id === r.product_id);
      const loc = r.location.trim();
      const locMatch = loc ? locations.find((l) => l.path === loc) : undefined;
      return {
        product_id: r.product_id,
        received_qty: parseInt(r.received_qty) || 0,
        lot_number: r.lot_number.trim(),
        expiry_date: r.expiry_date || null,
        location_id: loc ? locMatch?.id ?? -1 : null,
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
    setSaving(true);
    try {
      const { data } = await api.post(`/asns/${asn.id}/receive`, { items, notes: notes.trim() });
      addToast(`ASN ${data.asn_number} updated`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error receiving ASN", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Receive ${asn.asn_number}`} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="divide-y divide-gray-100 max-h-[50vh] overflow-auto border border-gray-200 rounded-lg">
          {rows.map((row, idx) => {
            const product = productList.find((p) => p.id === row.product_id);
            return (
              <div key={idx} className="p-4 space-y-2">
                <p className="text-sm font-medium">{row.product_name}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Qty Received</label>
                    <input type="number" min={1} className="input" value={row.received_qty} onChange={(e) => setRow(idx, "received_qty", e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Lot #</label>
                    <input className="input" value={row.lot_number} onChange={(e) => setRow(idx, "lot_number", e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Expiry</label>
                    <input type="date" className="input" value={row.expiry_date} onChange={(e) => setRow(idx, "expiry_date", e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                    <LocationPicker value={row.location} onChange={(v) => setRow(idx, "location", v)} />
                  </div>
                </div>
                {product?.is_serialized && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Serial numbers (one per line)</label>
                    <textarea className="input font-mono text-xs" rows={2} value={row.serial_numbers} onChange={(e) => setRow(idx, "serial_numbers", e.target.value)} placeholder={"SN-001\nSN-002"} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
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
