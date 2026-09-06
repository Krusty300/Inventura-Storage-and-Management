import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_LOOKUP } from "../utils/constants";
import Modal from "./Modal";
import FittedSelect from "./FittedSelect";
import type { Location, SerialNumber } from "../types";
import { useToast } from "../context/ToastContext";

interface Props {
  productId: number;
  productName: string;
  available: number;
  isSerialized?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function MoveUnallocatedModal({ productId, productName, available, isSerialized = false, onClose, onSaved }: Props) {
  const [quantity, setQuantity] = useState(String(available));
  const [selectedSerials, setSelectedSerials] = useState<Set<number>>(new Set());
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const { addToast } = useToast();

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", "move-unallocated"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return (data.items || []) as Location[];
    },
  });
  const activeLocations = locations.filter((l) => l.is_active);

  const { data: serials = [] } = useQuery({
    queryKey: ["serial-numbers", "move-unallocated", productId],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", {
        params: { product_id: productId, status: "in_stock", no_location: true, limit: PAGE_SIZE },
      });
      return (data.items || []) as SerialNumber[];
    },
    enabled: isSerialized,
  });

  const toggleSerial = (id: number) => {
    const next = new Set(selectedSerials);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSerials(next);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/stock-movements/unallocated-move", {
        product_id: productId,
        quantity: isSerialized ? selectedSerials.size : Number(quantity),
        to_location_id: Number(toLocationId),
        ...(isSerialized ? { serial_ids: [...selectedSerials] } : {}),
        notes,
      });
      return data as { reference: string };
    },
    onSuccess: () => {
      addToast("Unallocated stock moved to location", "success");
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      addToast(detail || "Could not move unallocated stock", "error");
    },
  });

  const canSubmit =
    !mutation.isPending &&
    !!toLocationId &&
    (isSerialized ? selectedSerials.size > 0 : Number(quantity) > 0 && Number(quantity) <= available);

  return (
    <Modal open onClose={onClose} title="Move Unallocated Stock">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Assign unallocated units of <span className="font-medium text-ink">{productName}</span> to a
          location so they show in the Stock Locations panel like other stock.
        </p>
        {isSerialized ? (
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Select serial numbers (available: {available})
            </label>
            {serials.length === 0 ? (
              <p className="text-sm text-faint">No unallocated serials found.</p>
            ) : (
              <>
                <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                  {serials.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-primary"
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
                    className="text-xs text-primary dark:text-primary hover:underline"
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
          <FittedSelect
            ariaLabel="Destination Location"
            value={toLocationId}
            onChange={setToLocationId}
            options={[
              { value: "", label: "Select location..." },
              ...activeLocations.map((l) => ({ value: String(l.id), label: l.path })),
            ]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Notes (optional)</label>
          <input className="input" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Moving..." : "Move Stock"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
