import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { Location, StockMovement } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { isSelectable, productLabel } from "../utils/variants";
import { errorMessage } from "../utils/errors";

interface Props {
  movement?: StockMovement | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function StockMovementForm({ movement, onClose, onSaved }: Props) {
  const isEdit = !!movement;
  const products = useSelectableProducts().filter((p) => !p.is_serialized);
  const [productId, setProductId] = useState(movement?.product_id?.toString() || "");
  const [locationId, setLocationId] = useState("");
  const [quantityChange, setQuantityChange] = useState(
    movement ? (movement.movement_type === "out" ? Math.abs(movement.quantity_change).toString() : movement.quantity_change.toString()) : ""
  );
  const [movementType, setMovementType] = useState(movement?.movement_type || "in");
  const [reference, setReference] = useState(movement?.reference || "");
  const [notes, setNotes] = useState(movement?.notes || "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const { data: allLocations = [] } = useQuery({
    queryKey: ["locations", "movement-form"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return (data.items || []) as Location[];
    },
  });
  const activeLocations = allLocations.filter((l) => l.is_active);

  const productIdNum = productId ? parseInt(productId) : null;
  const stockLocations = useProductStockLocations(productIdNum, false);
  const stockCountByLoc = new Map(stockLocations.locations.map((l) => [l.location_id, l.count]));

  const locationOptions = [...activeLocations].sort((a, b) => a.path.localeCompare(b.path));
  const showLocation = !isEdit && !!productIdNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const rawQty = parseInt(quantityChange) || 0;
    const qty = movementType === "out" ? -Math.abs(rawQty) : movementType === "in" ? Math.abs(rawQty) : rawQty;
    if (qty === 0) {
      addToast("Quantity must not be zero", "error");
      setSaving(false);
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        product_id: parseInt(productId),
        quantity_change: qty,
        movement_type: movementType,
        reference,
        notes,
      };
      if (!isEdit) {
        payload.location_id = locationId ? parseInt(locationId) : null;
      }
      if (isEdit) {
        await api.put(`/stock-movements/${movement!.id}`, payload);
        addToast("Stock movement updated", "success");
      } else {
        await api.post("/stock-movements", payload);
        addToast("Stock movement recorded", "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, `Error ${isEdit ? "updating" : "recording"} movement`), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Stock Movement" : "Record Stock Movement"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product *</label>
            {!isEdit && <BarcodeScanner onProductFound={(p) => { if (isSelectable(p)) setProductId(p.id.toString()); else addToast("Product has variants - scan a specific variant", "error"); }} placeholder="Scan barcode to select..." autoFocus />}
            <select className={!isEdit ? "select mt-2" : "select"} value={productId} onChange={(e) => { setProductId(e.target.value); setLocationId(""); }} required>
              <option value="">Select product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Movement Type</label>
            <select className="select" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
              <option value="in">Stock In</option>
              <option value="out">Stock Out</option>
              <option value="adjustment">Adjustment</option>
              <option value="return">Return</option>
            </select>
          </div>
          {showLocation && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Location *</label>
              <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Default (product location)</option>
                {locationOptions.map((l) => {
                  const count = stockCountByLoc.get(l.id);
                  return <option key={l.id} value={l.id}>{l.path}{count !== undefined ? ` (${count})` : ""}</option>;
                })}
              </select>
              <p className="text-xs text-faint mt-1">
                {movementType === "out"
                  ? "Stock will be removed from this location."
                  : "Stock will be added to this location."}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-app p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Quantity *</label>
            <input
              type="number"
              className="input"
              value={quantityChange}
              onChange={(e) => setQuantityChange(e.target.value)}
              min={movementType === "adjustment" ? undefined : "1"}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Reference (e.g. PO#)</label>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
            <p className="text-xs text-faint mt-1">Leave blank to auto-generate a reference.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : (isEdit ? "Update Movement" : "Record")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
