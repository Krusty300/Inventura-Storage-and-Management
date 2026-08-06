import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../api/client";
import Modal from "./Modal";
import type { Location } from "../types";
import { useToast } from "../context/ToastContext";

interface Props {
  productId: number;
  productName: string;
  available: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function MoveUnallocatedModal({ productId, productName, available, onClose, onSaved }: Props) {
  const [quantity, setQuantity] = useState(String(available));
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const { addToast } = useToast();

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", "move-unallocated"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return (data.items || []) as Location[];
    },
  });
  const activeLocations = locations.filter((l) => l.is_active);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/stock-movements/unallocated-move", {
        product_id: productId,
        quantity: Number(quantity),
        to_location_id: Number(toLocationId),
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
    !mutation.isPending && Number(quantity) > 0 && Number(quantity) <= available && !!toLocationId;

  return (
    <Modal open onClose={onClose} title="Move Unallocated Stock">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Assign unallocated units of <span className="font-medium text-ink">{productName}</span> to a
          location so they show in the Stock Locations panel like other stock.
        </p>
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
            {mutation.isPending ? "Moving..." : "Move Stock"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
