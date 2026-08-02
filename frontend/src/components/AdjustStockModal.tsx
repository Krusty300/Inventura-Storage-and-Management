import { useState } from "react";
import Modal from "./Modal";
import api from "../api/client";
import type { Product } from "../types";

const REASON_CODES = ["damaged", "lost", "found", "recount"];

interface Props {
  product: Product;
  onClose: () => void;
  onAdjusted: () => void;
}

export default function AdjustStockModal({ product, onClose, onAdjusted }: Props) {
  const [newQty, setNewQty] = useState(product.quantity.toString());
  const [reasonCode, setReasonCode] = useState("recount");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const qtyDelta = parseInt(newQty) - product.quantity;
  const isValid = newQty !== "" && !isNaN(parseInt(newQty)) && parseInt(newQty) >= 0 && qtyDelta !== 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post("/stock-movements/adjust", {
        product_id: product.id,
        new_quantity: parseInt(newQty),
        reason_code: reasonCode,
        notes,
      });
      onAdjusted();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Adjustment failed");
    }
    setSubmitting(false);
  };

  return (
    <Modal open onClose={onClose} title="Adjust Stock">
      <div className="space-y-4">
        <div className="text-sm">
          <span className="font-medium">{product.display_name}</span>
          <span className="text-gray-500 ml-2">({product.sku})</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Quantity</label>
            <div className="input bg-gray-50">{product.quantity}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Quantity</label>
            <input
              type="number"
              min={0}
              className="input"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {qtyDelta !== 0 && !isNaN(qtyDelta) && (
          <div className={`text-sm font-medium ${qtyDelta > 0 ? "text-green-600" : "text-red-600"}`}>
            Will {qtyDelta > 0 ? "add" : "remove"} {Math.abs(qtyDelta)} unit{Math.abs(qtyDelta) !== 1 ? "s" : ""}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
          <select className="select" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            {REASON_CODES.map((rc) => (
              <option key={rc} value={rc}>{rc.charAt(0).toUpperCase() + rc.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
          <button onClick={handleSubmit} disabled={!isValid || submitting} className="btn-primary text-sm px-3 py-1.5">
            {submitting ? "Adjusting..." : "Adjust Stock"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
