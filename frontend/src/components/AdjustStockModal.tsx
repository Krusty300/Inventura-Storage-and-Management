import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "./Modal";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { Location, Product } from "../types";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { errorMessage } from "../utils/errors";

const REASON_CODES = ["damaged", "lost", "found", "recount"];

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

interface Props {
  product: Product;
  onClose: () => void;
  onAdjusted: () => void;
}

export default function AdjustStockModal({ product, onClose, onAdjusted }: Props) {
  const [newQty, setNewQty] = useState(product.quantity.toString());
  const [locationId, setLocationId] = useState("");
  const [locationTouched, setLocationTouched] = useState(false);
  const [reasonCode, setReasonCode] = useState("recount");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: allLocations = [] } = useQuery({
    queryKey: ["locations", "adjust-form"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return (data.items || []) as Location[];
    },
  });
  const activeLocations = allLocations.filter((l) => l.is_active);

  const stockLocations = useProductStockLocations(product.id, false);
  const stockCountByLoc = new Map(stockLocations.locations.map((l) => [l.location_id, l.count]));

  useEffect(() => {
    if (locationTouched || locationId !== "") return;
    const stocked = stockLocations.locations.filter((l) => l.count > 0);
    if (stocked.length === 0) return;
    const top = [...stocked].sort((a, b) => b.count - a.count)[0];
    const id = String(top.location_id);
    setLocationId(id);
    setNewQty(String(top.count));
  }, [stockLocations.locations, locationId, locationTouched]);

  const locationOptions = [...activeLocations].sort((a, b) => a.path.localeCompare(b.path));
  const currentQty = locationId ? stockCountByLoc.get(parseInt(locationId)) ?? 0 : product.quantity;

  const qtyDelta = parseInt(newQty) - currentQty;
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
        location_id: locationId ? parseInt(locationId) : null,
      });
      onAdjusted();
    } catch (err: unknown) {
      setError(errorMessage(err, "Adjustment failed"));
    }
    setSubmitting(false);
  };

  return (
    <Modal open onClose={onClose} title="Adjust Stock" wide>
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <div className="border-b border-border px-6 py-4">
          <p className={sectionLabel}>Stock Adjustment</p>
          <h3 className="text-lg font-bold text-ink mt-0.5 tracking-tight">{product.display_name}</h3>
          <p className="text-sm text-muted">{product.sku}</p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Location</label>
            <select className="select" value={locationId} onChange={(e) => {
              setLocationTouched(true);
              const v = e.target.value;
              setLocationId(v);
              const id = v ? parseInt(v) : null;
              setNewQty((id != null ? (stockCountByLoc.get(id) ?? 0) : product.quantity).toString());
            }}>
              <option value="">Default (product location)</option>
              {locationOptions.map((l) => {
                const count = stockCountByLoc.get(l.id);
                return <option key={l.id} value={l.id}>{l.path}{count !== undefined ? ` (${count})` : ""}</option>;
              })}
            </select>
            <p className="text-xs text-faint mt-1">
              {locationId
                ? `New quantity will be the target stock at this location (current: ${currentQty}).`
                : "Applies to the product's default location. Pick a location to adjust stock there instead."}
              {!locationTouched && locationId !== "" && " Auto-detected from existing stock."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Current Quantity</label>
              <div className="input bg-app">{currentQty}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">New Quantity</label>
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
            <div className={`text-sm font-medium ${qtyDelta > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              Will {qtyDelta > 0 ? "add" : "remove"} {Math.abs(qtyDelta)} unit{Math.abs(qtyDelta) !== 1 ? "s" : ""}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Reason</label>
            <select className="select" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {REASON_CODES.map((rc) => (
                <option key={rc} value={rc}>{rc.charAt(0).toUpperCase() + rc.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <button onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
            <button onClick={handleSubmit} disabled={!isValid || submitting} className="btn-primary text-sm px-3 py-1.5">
              {submitting ? "Adjusting..." : "Adjust Stock"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
