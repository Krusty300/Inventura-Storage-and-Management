import { useMemo, useState } from "react";
import { ArrowLeftRight, AlertTriangle, Fingerprint } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Location, SerialNumber, StockLocation } from "../types";
import Modal from "./Modal";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useToast } from "../context/ToastContext";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function TransferModal({ onClose, onSaved }: Props) {
  const [product_id, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [serialNumbers, setSerialNumbers] = useState("");
  const [from_location_id, setFromLocationId] = useState("");
  const [to_location_id, setToLocationId] = useState("");
  const [lot_id, setLotId] = useState("");
  const [notes, setNotes] = useState("");
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const productList = useSelectableProducts();
  const selectedProduct = productList.find((p) => p.id === Number(product_id));
  const isSerialized = !!selectedProduct?.is_serialized;

  const { data: locations } = useQuery({
    queryKey: ["locations", "transfer"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return data.items as Location[];
    },
  });

  const { data: stockLocations, isLoading: stockLoading } = useQuery({
    queryKey: ["stock-locations", "transfer", product_id],
    queryFn: async () => {
      const { data } = await api.get("/stock-movements/locations", { params: { product_id } });
      return (data?.locations || []) as StockLocation[];
    },
    enabled: !!product_id && !isSerialized,
  });

  const { data: serialsData, isLoading: serialsLoading } = useQuery({
    queryKey: ["serial-numbers", "transfer", product_id],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", {
        params: { product_id, status: "in_stock", limit: 200 },
      });
      return data.items as SerialNumber[];
    },
    enabled: !!product_id && isSerialized,
  });

  const serialLocations = useMemo(() => {
    const map = new Map<number, { location_id: number; path: string; serials: SerialNumber[] }>();
    for (const s of serialsData || []) {
      if (s.lot_status && s.lot_status !== "in_stock") continue;
      if (!s.location_id) continue;
      const entry = map.get(s.location_id) || { location_id: s.location_id, path: s.location_name || "Location", serials: [] };
      entry.serials.push(s);
      map.set(s.location_id, entry);
    }
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [serialsData]);

  const availableSerials = serialLocations.find((l) => l.location_id === Number(from_location_id))?.serials || [];
  const availableSerialNumbers = new Set(availableSerials.map((s) => s.serial_number));

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (isSerialized) {
        const parsed = [...new Set(serialNumbers.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
        if (parsed.length === 0) throw new Error("Enter at least one serial number");
        const byNumber = new Map(availableSerials.map((s) => [s.serial_number, s]));
        for (const sn of parsed) {
          if (!byNumber.has(sn)) {
            throw new Error(`Serial '${sn}' is not available at the source location`);
          }
        }
        const { data } = await api.post("/stock-movements/transfer-serial", {
          product_id: Number(product_id),
          serial_ids: parsed.map((sn) => byNumber.get(sn)!.id),
          from_location_id: Number(from_location_id),
          to_location_id: Number(to_location_id),
          notes: notes.trim(),
        });
        return data;
      }
      const { data } = await api.post("/stock-movements/transfer", {
        product_id: Number(product_id),
        quantity: parseInt(quantity) || 1,
        from_location_id: Number(from_location_id),
        to_location_id: Number(to_location_id),
        lot_id: lot_id ? Number(lot_id) : null,
        notes: notes.trim(),
      });
      return data;
    },
    onSuccess: (data: any) => {
      addToast(`Transfer ${data.reference} completed`, "success");
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      onSaved();
    },
    onError: (err: any) => addToast(err.response?.data?.detail || err.message || "Transfer failed", "error"),
  });

  const activeLocations = (locations || []).filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path));
  const fromLocations = stockLocations || [];
  const selectedFrom = fromLocations.find((l) => l.location_id === Number(from_location_id));
  const selectedFromLot = selectedFrom?.lots.find((l) => l.lot_id === Number(lot_id));
  const maxQuantity = lot_id && selectedFrom ? (selectedFromLot?.quantity ?? selectedFrom.quantity) : selectedFrom?.quantity ?? 1;
  const noStock = !!product_id && !isSerialized && !stockLoading && !!stockLocations && stockLocations.length === 0;
  const noSerials = !!product_id && isSerialized && !serialsLoading && serialLocations.length === 0;

  const handleProductChange = (value: string) => {
    setProductId(value);
    setFromLocationId("");
    setToLocationId("");
    setLotId("");
    setSerialNumbers("");
  };

  const addSerial = (sn: string) => {
    const current = serialNumbers.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (current.includes(sn)) return;
    setSerialNumbers([...current, sn].join("\n"));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product_id || !from_location_id || !to_location_id) {
      addToast("Select product and both locations", "error");
      return;
    }
    if (from_location_id === to_location_id) {
      addToast("Source and destination must differ", "error");
      return;
    }
    if (isSerialized) {
      if (serialNumbers.trim().length === 0) {
        addToast("Enter at least one serial number", "error");
        return;
      }
      const parsed = [...new Set(serialNumbers.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
      for (const sn of parsed) {
        if (!availableSerialNumbers.has(sn)) {
          addToast(`Serial '${sn}' is not available at the source location`, "error");
          return;
        }
      }
      transferMutation.mutate();
      return;
    }
    const qty = parseInt(quantity) || 0;
    if (qty <= 0) {
      addToast("Enter a valid quantity", "error");
      return;
    }
    if (selectedFrom && qty > selectedFrom.quantity) {
      addToast(`Only ${selectedFrom.quantity} on hand at ${selectedFrom.path}`, "error");
      return;
    }
    transferMutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Transfer Stock Between Locations" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product *</label>
            <select className="select" value={product_id} onChange={(e) => handleProductChange(e.target.value)}>
              <option value="">Select...</option>
              {(productList || []).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}{p.is_serialized ? " (Serialized)" : ""}</option>)}
            </select>
          </div>
          {isSerialized ? (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Serial Numbers *</label>
              <textarea
                className="input min-h-16 font-mono text-sm"
                placeholder="Enter or scan one serial number per line"
                value={serialNumbers}
                onChange={(e) => setSerialNumbers(e.target.value)}
              />
              <p className="text-xs text-muted mt-1">Count: {serialNumbers.split(/[\n,]+/).filter((s) => s.trim()).length}</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Quantity *</label>
              <input type="number" min={1} max={maxQuantity} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              {selectedFrom && (
                <p className="text-xs text-muted mt-1">{selectedFrom.quantity} available at {selectedFrom.path}</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">From Location *</label>
            {isSerialized ? (
              <select
                className="select"
                value={from_location_id}
                disabled={!product_id}
                onChange={(e) => setFromLocationId(e.target.value)}
              >
                <option value="">
                  {!product_id ? "Select a product first" : serialsLoading ? "Loading serials..." : noSerials ? "No serials in stock" : "Select..."}
                </option>
                {serialLocations.map((l) => <option key={l.location_id} value={l.location_id}>{l.path} ({l.serials.length} serials)</option>)}
              </select>
            ) : (
              <select
                className="select"
                value={from_location_id}
                disabled={!product_id}
                onChange={(e) => { setFromLocationId(e.target.value); setLotId(""); }}
              >
                <option value="">
                  {!product_id ? "Select a product first" : stockLoading ? "Loading locations..." : noStock ? "No stock available" : "Select..."}
                </option>
                {fromLocations.map((l) => <option key={l.location_id} value={l.location_id}>{l.path} ({l.quantity} on hand)</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">To Location *</label>
            <select className="select" value={to_location_id} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">Select...</option>
              {activeLocations.filter((l) => l.id !== Number(from_location_id)).map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            {isSerialized ? (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Available at source</label>
                {from_location_id ? (
                  availableSerials.length === 0 ? (
                    <p className="text-xs text-muted">No in-stock serials at this location.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {availableSerials.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => addSerial(s.serial_number)}
                          className="text-xs font-mono px-2 py-1 rounded border border-border-strong bg-subtle text-ink hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        >
                          {s.serial_number}
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="text-xs text-muted flex items-center gap-1">
                    <Fingerprint size={14} className="text-indigo-500" />
                    Select a source location to see its in-stock serials. Click a serial to add it.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
                <select
                  className="select"
                  value={lot_id}
                  disabled={!selectedFrom}
                  onChange={(e) => setLotId(e.target.value)}
                >
                  <option value="">Any lot</option>
                  {(selectedFrom?.lots || []).map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_number} ({l.quantity})</option>)}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {noStock && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <AlertTriangle size={14} />
            This product has no stock at any location yet. Record a receipt or opening stock before transferring.
          </p>
        )}
        {noSerials && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <AlertTriangle size={14} />
            This serialized product has no in-stock serial numbers yet. Record a receipt for the product to create serial numbers.
          </p>
        )}

        <p className="text-xs text-muted flex items-center gap-1">
          <ArrowLeftRight size={14} className="text-indigo-500" />
          A single reference is used for both the outbound and inbound movement.
        </p>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={transferMutation.isPending || noStock || noSerials} className="btn-primary">
            {transferMutation.isPending ? "Transferring..." : "Transfer Stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
