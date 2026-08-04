import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import api from "../api/client";
import Modal from "./Modal";
import LocationPicker from "./LocationPicker";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useToast } from "../context/ToastContext";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

interface ItemRow {
  product_id: string;
  quantity: string;
  unit_cost: string;
  lot_number: string;
  expiry_date: string;
  location: string;
  lpn_number: string;
  serial_numbers: string;
}

const EMPTY_ROW: ItemRow = {
  product_id: "", quantity: "1", unit_cost: "0", lot_number: "",
  expiry_date: "", location: "", lpn_number: "", serial_numbers: "",
};

export default function ReceiptForm({ onClose, onSaved }: Props) {
  const [supplier_id, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const productList = useSelectableProducts();
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [locations, setLocations] = useState<{ id: number; path: string }[]>([]);
  const [lpns, setLpns] = useState<{ id: number; lpn_number: string }[]>([]);

  useEffect(() => {
    api.get("/suppliers", { params: { limit: 500 } }).then(({ data }) => setSuppliers(data.items));
    api.get("/locations", { params: { limit: 5000 } }).then(({ data }) => setLocations(data.items));
    api.get("/lpns", { params: { limit: 500 } }).then(({ data }) => setLpns(data.items));
  }, []);

  const setRow = (idx: number, key: keyof ItemRow, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const selectedProduct = (row: ItemRow) => productList.find((p) => p.id.toString() === row.product_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows
      .filter((r) => r.product_id)
      .map((r) => {
        const product = selectedProduct(r);
        const serial_numbers = r.serial_numbers.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        const loc = r.location.trim();
        const locMatch = loc ? locations.find((l) => l.path === loc) : undefined;
        const lpnNum = r.lpn_number.trim();
        const lpnMatch = lpnNum ? lpns.find((l) => l.lpn_number === lpnNum) : undefined;
        return {
          product_id: Number(r.product_id),
          quantity: parseInt(r.quantity) || 1,
          unit_cost: parseFloat(r.unit_cost) || 0,
          lot_number: r.lot_number.trim(),
          expiry_date: r.expiry_date || null,
          location_id: loc ? locMatch?.id ?? -1 : null,
          lpn_id: lpnNum ? lpnMatch?.id ?? -1 : null,
          serial_numbers: product?.is_serialized ? serial_numbers : [],
        };
      });
    if (items.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    const badLoc = items.find((i) => i.location_id === -1);
    if (badLoc) {
      addToast(`Unknown location - pick a location from the dropdown`, "error");
      return;
    }
    const badLpn = items.find((i) => i.lpn_id === -1);
    if (badLpn) {
      addToast("Unknown LPN number - create the LPN first or clear the field", "error");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/receipts", {
        supplier_id: supplier_id ? Number(supplier_id) : null,
        reference: reference.trim(),
        notes: notes.trim(),
        items,
      });
      addToast(`Receipt ${data.receipt_number} recorded`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error recording receipt", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="Record Receipt" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
            <select className="select" value={supplier_id} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Reference</label>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO-1001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-app px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Items</span>
            <button type="button" onClick={() => setRows([...rows, { ...EMPTY_ROW }])} className="btn-secondary text-xs py-1 px-2">
              <Plus size={14} className="inline mr-1" />Add Item
            </button>
          </div>
          <div className="divide-y divide-border max-h-[50vh] overflow-auto">
            {rows.map((row, idx) => {
              const product = selectedProduct(row);
              return (
                <div key={idx} className="p-4 space-y-3">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5">
                      <label className="block text-xs font-medium text-muted mb-1">Product</label>
                      <select className="select" value={row.product_id} onChange={(e) => setRow(idx, "product_id", e.target.value)}>
                        <option value="">Select...</option>
                        {productList.map((p) => (
                          <option key={p.id} value={p.id}>{productLabel(p)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-muted mb-1">Qty</label>
                      <input type="number" min={1} className="input" value={row.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-muted mb-1">Unit Cost</label>
                      <input type="number" step="0.01" min={0} className="input" value={row.unit_cost} onChange={(e) => setRow(idx, "unit_cost", e.target.value)} />
                    </div>
                    <div className="col-span-3 flex gap-2">
                      <input className="input" placeholder="Lot #" value={row.lot_number} onChange={(e) => setRow(idx, "lot_number", e.target.value)} aria-label="Lot number" />
                      <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove item">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="col-span-5">
                      <label className="block text-xs font-medium text-muted mb-1">Expiry</label>
                      <input type="date" className="input" value={row.expiry_date} onChange={(e) => setRow(idx, "expiry_date", e.target.value)} />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-xs font-medium text-muted mb-1">Location</label>
                      <LocationPicker value={row.location} onChange={(v) => setRow(idx, "location", v)} />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-muted mb-1">LPN (pallet)</label>
                      <input className="input" placeholder="e.g. LPN-1001" value={row.lpn_number} onChange={(e) => setRow(idx, "lpn_number", e.target.value)} />
                    </div>
                  </div>
                  {product?.is_serialized && (
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">
                        Serial numbers (one per line, must match quantity)
                      </label>
                      <textarea
                        className="input font-mono text-xs"
                        rows={2}
                        value={row.serial_numbers}
                        onChange={(e) => setRow(idx, "serial_numbers", e.target.value)}
                        placeholder={"SN-001\nSN-002"}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Record Receipt"}</button>
        </div>
      </form>
    </Modal>
  );
}
