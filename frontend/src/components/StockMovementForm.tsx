import { useState } from "react";
import api from "../api/client";
import type { StockMovement } from "../types";
import { useToast } from "../context/ToastContext";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { isSelectable, productLabel } from "../utils/variants";

interface Props {
  movement?: StockMovement | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function StockMovementForm({ movement, onClose, onSaved }: Props) {
  const isEdit = !!movement;
  const products = useSelectableProducts().filter((p) => !p.is_serialized);
  const [productId, setProductId] = useState(movement?.product_id?.toString() || "");
  const [quantityChange, setQuantityChange] = useState(
    movement ? (movement.movement_type === "out" ? Math.abs(movement.quantity_change).toString() : movement.quantity_change.toString()) : ""
  );
  const [movementType, setMovementType] = useState(movement?.movement_type || "in");
  const [reference, setReference] = useState(movement?.reference || "");
  const [notes, setNotes] = useState(movement?.notes || "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

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
      const payload = {
        product_id: parseInt(productId),
        quantity_change: qty,
        movement_type: movementType,
        reference,
        notes,
      };
      if (isEdit) {
        await api.put(`/stock-movements/${movement!.id}`, payload);
        addToast("Stock movement updated", "success");
      } else {
        await api.post("/stock-movements", payload);
        addToast("Stock movement recorded", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || `Error ${isEdit ? "updating" : "recording"} movement`, "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Stock Movement" : "Record Stock Movement"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Product *</label>
          {!isEdit && <BarcodeScanner onProductFound={(p) => { if (isSelectable(p)) setProductId(p.id.toString()); else addToast("Product has variants - scan a specific variant", "error"); }} placeholder="Scan barcode to select..." autoFocus />}
          <select className="select mt-2" value={productId} onChange={(e) => setProductId(e.target.value)} required>
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
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : (isEdit ? "Update Movement" : "Record")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
