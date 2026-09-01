import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PICKER } from "../utils/constants";
import Modal from "./Modal";
import Skeleton from "./Skeleton";
import LocationPicker from "./LocationPicker";
import StockLocationHints from "./StockLocationHints";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { productLabel } from "../utils/variants";
import { useToast } from "../context/ToastContext";
import type { LPN, Product } from "../types";
import { errorMessage } from "../utils/errors";

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

interface ItemRowProps {
  row: ItemRow;
  idx: number;
  productList: Product[];
  rowProducts: Product[];
  locations: { id: number; path: string }[];
  onChange: (idx: number, key: keyof ItemRow, value: string) => void;
  onRemove: (idx: number) => void;
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

function ReceiptItemRow({ row, idx, productList, rowProducts, locations, onChange, onRemove }: ItemRowProps) {
  const product = productList.find((p) => p.id.toString() === row.product_id);
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

  const handleProductChange = (id: string) => {
    onChange(idx, "product_id", id);
    onChange(idx, "lpn_number", "");
    const p = productList.find((x) => x.id.toString() === id);
    onChange(idx, "unit_cost", p ? String(p.cost_price ?? 0) : "0");
    if (p?.location) {
      onChange(idx, "location", p.location);
    } else {
      onChange(idx, "location", "");
    }
  };

  const handleLocationChange = (v: string) => {
    onChange(idx, "location", v);
    onChange(idx, "lpn_number", "");
  };

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
        <div className="sm:col-span-5">
          <label className="block text-xs font-medium text-muted mb-1">Product</label>
          <select className="select" aria-label="Product" value={row.product_id} onChange={(e) => handleProductChange(e.target.value)}>
            <option value="">Select...</option>
            {rowProducts.map((p) => (
              <option key={p.id} value={p.id}>{productLabel(p)}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-muted mb-1">Qty</label>
          <input type="number" min={1} className="input" value={row.quantity} onChange={(e) => onChange(idx, "quantity", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-muted mb-1">Unit Cost</label>
          <input type="number" step="0.01" min={0} className="input" aria-label="Unit cost" value={row.unit_cost} onChange={(e) => onChange(idx, "unit_cost", e.target.value)} />
        </div>
        <div className="sm:col-span-3 flex gap-2">
          <input className="input flex-1" placeholder="Lot #" value={row.lot_number} onChange={(e) => onChange(idx, "lot_number", e.target.value)} aria-label="Lot number" />
          <button type="button" onClick={() => onRemove(idx)} className="p-2 text-faint hover:text-red-600 dark:text-red-400" aria-label="Remove item">
            <Trash2 size={16} />
          </button>
        </div>
        <div className="sm:col-span-5">
          <label className="block text-xs font-medium text-muted mb-1">Expiry</label>
          <input type="date" className="input" value={row.expiry_date} onChange={(e) => onChange(idx, "expiry_date", e.target.value)} />
        </div>
        <div className="sm:col-span-4">
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
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-muted mb-1">LPN (pallet)</label>
          <input className="input" list={`lpn-options-${idx}`} placeholder="e.g. LPN-1001" aria-label="LPN number" value={row.lpn_number} onChange={(e) => onChange(idx, "lpn_number", e.target.value)} />
          <datalist id={`lpn-options-${idx}`}>
            {lpns.map((l) => (
              <option key={l.id} value={l.lpn_number}>
                {l.content_count === 0 ? "empty pallet" : `${l.total_quantity} units`}
              </option>
            ))}
          </datalist>
          {lpnsLoading && <Skeleton variant="text" className="w-24 h-3 mt-1" />}
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
            onChange={(e) => onChange(idx, "serial_numbers", e.target.value)}
            placeholder={"SN-001\nSN-002"}
          />
        </div>
      )}
    </div>
  );
}

export default function ReceiptForm({ onClose, onSaved }: Props) {
  const [supplier_id, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
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
  const { data: lpns = [] } = useQuery<{ id: number; lpn_number: string }[]>({
    queryKey: ["lpns", "picker"],
    queryFn: async () => (await api.get("/lpns", { params: { limit: PAGE_SIZE_PICKER } })).data.items,
  });

  const supplierOwned = useMemo(() => {
    if (!supplier_id) return [];
    return productList.filter((p) => p.supplier_id?.toString() === supplier_id);
  }, [productList, supplier_id]);

  const rowProducts = supplierOwned.length > 0 ? supplierOwned : productList;

  useEffect(() => {
    if (!supplier_id) return;
    const only = supplierOwned.length === 1 ? supplierOwned[0] : null;
    setRows((prev) => {
      let changed = false;
      let filled = false;
      const next = prev.map((r) => {
        if (!r.product_id) {
          if (only && !filled) {
            filled = true;
            changed = true;
            return { ...r, product_id: only.id.toString(), unit_cost: String(only.cost_price ?? 0) };
          }
          return r;
        }
        const p = productList.find((x) => x.id.toString() === r.product_id);
        if (p && p.supplier_id?.toString() !== supplier_id) {
          changed = true;
          return { ...EMPTY_ROW, quantity: "1" };
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [supplier_id, supplierOwned]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (idx: number, key: keyof ItemRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
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
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error recording receipt"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title="Record Receipt" wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-app p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
              <select className="select" aria-label="Supplier" value={supplier_id} onChange={(e) => setSupplierId(e.target.value)}>
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
        </div>

        <div className="rounded-xl border border-border bg-app overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-subtle">
            <span className="text-sm font-medium text-ink">Items</span>
            <button type="button" onClick={() => setRows([...rows, { ...EMPTY_ROW }])} className="btn-secondary text-xs py-1.5 px-2 inline-flex items-center gap-1">
              <Plus size={14} />Add Item
            </button>
          </div>
          <div className="divide-y divide-border max-h-[50vh] overflow-auto">
            {rows.map((row, idx) => (
              <ReceiptItemRow
                key={idx}
                row={row}
                idx={idx}
                productList={productList}
                rowProducts={rowProducts}
                locations={locations}
                onChange={setRow}
                onRemove={(i) => setRows(rows.filter((_, x) => x !== i))}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Record Receipt"}</button>
        </div>
      </form>
    </Modal>
  );
}
