import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../api/client";
import Modal from "./Modal";
import type { Location, QuarantinedLocation, SerialNumber } from "../types";
import { useToast } from "../context/ToastContext";

interface Props {
  productId: number;
  productName: string;
  lotId?: number;
  lotNumber?: string;
  isSerialized?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function MoveQuarantinedModal({ productId, productName, lotId, lotNumber, isSerialized = false, onClose, onSaved }: Props) {
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [selectedSerials, setSelectedSerials] = useState<Set<number>>(new Set());
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const { addToast } = useToast();

  const { data: quarantinedLocations = [], isPending } = useQuery({
    queryKey: ["quarantined-locations", productId, lotId],
    queryFn: async () => {
      const { data } = await api.get("/stock-movements/quarantined-locations", {
        params: { product_id: productId, ...(lotId ? { lot_id: lotId } : {}) },
      });
      return (data.locations || []) as QuarantinedLocation[];
    },
  });

  useEffect(() => {
    if (sourceLocationId === "" && quarantinedLocations.length === 1) {
      setSourceLocationId(String(quarantinedLocations[0].location_id));
    }
  }, [quarantinedLocations, sourceLocationId]);

  const source = quarantinedLocations.find((l) => l.location_id === Number(sourceLocationId));

  const { data: serials = [] } = useQuery({
    queryKey: ["serial-numbers", "quarantined-move", productId, sourceLocationId],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", {
        params: { product_id: productId, status: "quarantined", location_id: sourceLocationId, limit: 200 },
      });
      return (data.items || []) as SerialNumber[];
    },
    enabled: isSerialized && !!sourceLocationId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", "move-quarantined"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return (data.items || []) as Location[];
    },
  });
  const activeLocations = locations.filter((l) => l.is_active);

  const available = isSerialized ? serials.length : (source?.quantity ?? 0);

  const toggleSerial = (id: number) => {
    const next = new Set(selectedSerials);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSerials(next);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/stock-movements/quarantined-move", {
        product_id: productId,
        quantity: isSerialized ? selectedSerials.size : Number(quantity),
        from_location_id: Number(sourceLocationId),
        to_location_id: Number(toLocationId),
        ...(lotId ? { lot_id: lotId } : {}),
        ...(isSerialized ? { serial_ids: [...selectedSerials] } : {}),
        notes,
      });
      return data as { reference: string };
    },
    onSuccess: () => {
      addToast("Quarantined stock moved to location", "success");
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      addToast(detail || "Could not move quarantined stock", "error");
    },
  });

  const canSubmit =
    !mutation.isPending &&
    !!sourceLocationId &&
    !!toLocationId &&
    (isSerialized ? selectedSerials.size > 0 : Number(quantity) > 0 && Number(quantity) <= available);

  return (
    <Modal open onClose={onClose} title={`Move Quarantined Stock${lotNumber ? `: ${lotNumber}` : ""}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Relocate quarantined units of <span className="font-medium text-ink">{productName}</span> to another
          location without releasing them. The lot(s) and serials stay quarantined.
        </p>

        {isPending ? (
          <p className="text-sm text-faint">Loading quarantined stock...</p>
        ) : quarantinedLocations.length === 0 ? (
          <p className="text-sm text-faint">No quarantined stock at any location.</p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Source Location</label>
              <select className="select" aria-label="Source Location" value={sourceLocationId} onChange={(e) => { setSourceLocationId(e.target.value); setSelectedSerials(new Set()); }}>
                <option value="">Select location...</option>
                {quarantinedLocations.map((l) => (
                  <option key={l.location_id} value={l.location_id}>{l.path} ({l.quantity})</option>
                ))}
              </select>
            </div>

            {isSerialized ? (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Select serial numbers (available: {available})
                </label>
                {serials.length === 0 ? (
                  <p className="text-sm text-faint">No quarantined serials at this location.</p>
                ) : (
                  <>
                    <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                      {serials.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-indigo-600"
                            checked={selectedSerials.has(s.id)}
                            onChange={() => toggleSerial(s.id)}
                          />
                          <span className="text-ink">{s.serial_number}</span>
                          {s.lot_number && <span className="text-muted text-xs">Lot {s.lot_number}</span>}
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-2 text-sm">
                      <span className="text-muted">{selectedSerials.size} of {serials.length} selected</span>
                      <button
                        type="button"
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        onClick={() => setSelectedSerials(selectedSerials.size === serials.length ? new Set() : new Set(serials.map((s) => s.id)))}
                      >
                        {selectedSerials.size === serials.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Quantity (available: {available})</label>
                <input
                  type="number"
                  min={1}
                  max={available}
                  className="input"
                  value={quantity}
                  aria-label="Quantity"
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Destination Location</label>
              <select className="select" aria-label="Destination Location" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                <option value="">Select location...</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.path}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Notes (optional)</label>
              <input className="input" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={!canSubmit} onClick={() => mutation.mutate()}>
                {mutation.isPending ? "Moving..." : "Move Quarantined Stock"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
