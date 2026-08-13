import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import Modal from "./Modal";
import type { Location, SerialNumber } from "../types";
import { useToast } from "../context/ToastContext";

interface Props {
  serial: SerialNumber;
  onClose: () => void;
  onSaved: () => void;
}

export default function QuarantineSerialModal({ serial, onClose, onSaved }: Props) {
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const { addToast } = useToast();

  const { data: locations = [], isPending } = useQuery({
    queryKey: ["locations", "quarantine-areas"],
    queryFn: async () => {
      const { data } = await api.get("/locations", {
        params: { location_type: "quarantine", limit: PAGE_SIZE_LOOKUP },
      });
      return (data.items || []) as Location[];
    },
  });
  const quarantineAreas = locations.filter((l) => l.is_active);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/stock-movements/quarantine", {
        product_id: serial.product_id,
        serial_ids: [serial.id],
        from_location_id: serial.location_id,
        to_location_id: Number(toLocationId),
        quantity: 1,
        notes,
      });
      return data as { reference: string };
    },
    onSuccess: () => {
      addToast(`Serial ${serial.serial_number} quarantined`, "success");
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      addToast(detail || "Could not quarantine serial", "error");
    },
  });

  const canSubmit = !mutation.isPending && !!toLocationId;

  return (
    <Modal open onClose={onClose} title={`Quarantine ${serial.serial_number}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Move serial <span className="font-medium text-ink font-mono">{serial.serial_number}</span>
          {" "}({serial.product_name}) to a quarantine area. The serial and its lot become quarantined
          until released.
        </p>

        {isPending ? (
          <p className="text-sm text-faint">Loading quarantine areas...</p>
        ) : quarantineAreas.length === 0 ? (
          <p className="text-sm text-faint">No active quarantine areas exist. Create a location with type &quot;quarantine&quot; first.</p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Quarantine Location</label>
              <select className="select" aria-label="Quarantine Location" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                <option value="">Select location...</option>
                {quarantineAreas.map((l) => (
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
                {mutation.isPending ? "Quarantining..." : "Quarantine Serial"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
