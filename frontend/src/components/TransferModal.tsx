import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Location } from "../types";
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
  const [from_location_id, setFromLocationId] = useState("");
  const [to_location_id, setToLocationId] = useState("");
  const [lot_id, setLotId] = useState("");
  const [notes, setNotes] = useState("");
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const selectableProductsList = useSelectableProducts();
  const productList = selectableProductsList.filter((p) => !p.is_serialized);

  const { data: locations } = useQuery({
    queryKey: ["locations", "transfer"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return data.items as Location[];
    },
  });

  const { data: lots } = useQuery({
    queryKey: ["lots", "transfer", product_id],
    queryFn: async () => {
      if (!product_id) return [];
      const { data } = await api.get("/lots", { params: { product_id, limit: 200 } });
      return data.items as { id: number; lot_number: string; on_hand: number }[];
    },
    enabled: !!product_id,
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
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
      onSaved();
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Transfer failed", "error"),
  });

  const activeLocations = (locations || []).filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path));

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
    transferMutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Transfer Stock Between Locations" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Product *</label>
            <select className="select" value={product_id} onChange={(e) => { setProductId(e.target.value); setLotId(""); }}>
              <option value="">Select...</option>
              {(productList || []).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Quantity *</label>
            <input type="number" min={1} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">From Location *</label>
            <select className="select" value={from_location_id} onChange={(e) => setFromLocationId(e.target.value)}>
              <option value="">Select...</option>
              {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">To Location *</label>
            <select className="select" value={to_location_id} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">Select...</option>
              {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
            <select className="select" value={lot_id} onChange={(e) => setLotId(e.target.value)}>
              <option value="">Any lot</option>
              {(lots || []).filter((l) => l.on_hand > 0).map((l) => <option key={l.id} value={l.id}>{l.lot_number}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <p className="text-xs text-muted flex items-center gap-1">
          <ArrowLeftRight size={14} className="text-indigo-500" />
          A single reference is used for both the outbound and inbound movement.
        </p>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={transferMutation.isPending} className="btn-primary">
            {transferMutation.isPending ? "Transferring..." : "Transfer Stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
