import { useMemo, useState } from "react";
import { ArrowLeftRight, ArrowRight, ArrowDown, AlertTriangle, Fingerprint } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE, PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { Location, SerialNumber, StockLocation } from "../types";
import SlideOver from "./SlideOver";
import FittedSelect from "./FittedSelect";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

function SectionHeading({ step, children }: { step: number; children: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-solid text-white text-xs font-semibold shrink-0">
        {step}
      </span>
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
    </div>
  );
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
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
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
        params: { product_id, status: "in_stock", limit: PAGE_SIZE },
      });
      return data.items as SerialNumber[];
    },
    enabled: !!product_id && isSerialized,
  });

  const serialLocations = useMemo(() => {
    const map = new Map<number, { location_id: number; path: string; serials: SerialNumber[] }>();
    for (const s of serialsData || []) {
      if (s.lot_status && s.lot_status !== "in_stock") continue;
      if (s.lpn_id != null) continue;
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
    onError: (err: unknown) => addToast(errorMessage(err, "Transfer failed"), "error"),
  });

  const activeLocations = (locations || []).filter((l) => l.is_active).sort((a, b) => a.path.localeCompare(b.path));
  const fromLocations = stockLocations || [];
  const selectedFrom = fromLocations.find((l) => l.location_id === Number(from_location_id));
  const toSelected = activeLocations.find((l) => l.id === Number(to_location_id));
  const selectedFromLot = selectedFrom?.lots.find((l) => l.lot_id === Number(lot_id));
  const maxQuantity = lot_id && selectedFrom ? (selectedFromLot?.quantity ?? selectedFrom.quantity) : selectedFrom?.quantity ?? 1;
  const noStock = !!product_id && !isSerialized && !stockLoading && !!stockLocations && stockLocations.length === 0;
  const noSerials = !!product_id && isSerialized && !serialsLoading && serialLocations.length === 0;
  const serialCount = serialNumbers.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length;
  const transferQty = isSerialized ? serialCount : parseInt(quantity) || 0;
  const transferComplete = !!product_id && !!from_location_id && !!to_location_id && transferQty > 0;

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
    if (selectedFrom && qty > maxQuantity) {
      addToast(`Only ${maxQuantity} available for the selected lot at ${selectedFrom.path}`, "error");
      return;
    }
    transferMutation.mutate();
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      ariaLabel="Transfer Stock Between Locations"
      title="Transfer Stock Between Locations"
      wide
      actions={
        <button type="submit" form="transfer-form" disabled={transferMutation.isPending || noStock || noSerials} className="btn-primary">
          {transferMutation.isPending ? "Transferring..." : "Transfer Stock"}
        </button>
      }
    >
      <form id="transfer-form" onSubmit={handleSubmit} className="space-y-5">
        {/* 1. Product & quantity */}
        <section className="border border-border rounded-xl overflow-hidden">
          <header className="px-5 py-3 bg-app border-b border-border">
            <SectionHeading step={1}>Product & Quantity</SectionHeading>
          </header>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1">Product *</label>
              <FittedSelect
                ariaLabel="Product"
                value={product_id}
                onChange={handleProductChange}
                options={(productList || []).map((p) => ({
                  value: String(p.id),
                  label: `${productLabel(p)}${p.is_serialized ? " (Serialized)" : ""}`,
                }))}
                placeholder="Select a product..."
              />
            </div>
            {isSerialized ? (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink mb-1">Serial Numbers *</label>
                <textarea
                  className="input min-h-16 font-mono text-sm"
                  placeholder="Enter or scan one serial number per line"
                  value={serialNumbers}
                  onChange={(e) => setSerialNumbers(e.target.value)}
                />
                <p className="text-xs text-muted mt-1">Count: {serialCount}</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Quantity *</label>
                  <input type="number" min={1} max={maxQuantity} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  {selectedFrom && (
                    <p className="text-xs text-muted mt-1">{selectedFrom.quantity} available at {selectedFrom.path}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">On hand by location</label>
                  {product_id && !stockLoading && fromLocations.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {fromLocations.map((l) => (
                        <button
                          key={l.location_id}
                          type="button"
                          onClick={() => { setFromLocationId(String(l.location_id)); setLotId(""); }}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                            Number(from_location_id) === l.location_id
                              ? "border-primary bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary font-medium"
                              : "border-border-strong bg-subtle text-ink hover:border-primary hover:text-primary dark:hover:text-primary"
                          }`}
                        >
                          {l.path} · {l.quantity}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      {stockLoading ? "Checking stock..." : "Select a product to see available stock."}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          </div>
        </section>

        {/* 2. Route */}
        <section className="border border-border rounded-xl overflow-hidden">
          <header className="px-5 py-3 bg-app border-b border-border">
            <SectionHeading step={2}>Transfer Route</SectionHeading>
          </header>
          <div className="p-5 space-y-4">
            <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">From Location *</label>
              {isSerialized ? (
                <FittedSelect
                  ariaLabel="From location"
                  value={from_location_id}
                  onChange={setFromLocationId}
                  disabled={!product_id}
                  options={serialLocations.map((l) => ({
                    value: String(l.location_id),
                    label: `${l.path} (${l.serials.length} serials)`,
                  }))}
                  placeholder={
                    !product_id
                      ? "Select a product first"
                      : serialsLoading
                        ? "Loading serials..."
                        : noSerials
                          ? "No serials in stock"
                          : "Select a location..."
                  }
                />
              ) : (
                <FittedSelect
                  ariaLabel="From location"
                  value={from_location_id}
                  onChange={(v) => { setFromLocationId(v); setLotId(""); }}
                  disabled={!product_id}
                  options={fromLocations.map((l) => ({
                    value: String(l.location_id),
                    label: `${l.path} (${l.quantity} on hand)`,
                  }))}
                  placeholder={
                    !product_id
                      ? "Select a product first"
                      : stockLoading
                        ? "Loading locations..."
                        : noStock
                          ? "No stock available"
                          : "Select a location..."
                  }
                />
              )}
            </div>

            <div className="flex items-center justify-center gap-2 self-center text-faint select-none sm:px-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest">to</span>
              <ArrowRight size={18} className="hidden sm:block text-primary" />
              <ArrowDown size={18} className="sm:hidden text-primary" />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">To Location *</label>
              <FittedSelect
                ariaLabel="To location"
                value={to_location_id}
                onChange={setToLocationId}
                options={activeLocations
                  .filter((l) => l.id !== Number(from_location_id))
                  .map((l) => ({ value: String(l.id), label: l.path }))}
                placeholder="Select a location..."
              />
            </div>
          </div>

          {transferComplete && selectedFrom && toSelected && (
            <div className="rounded-lg border border-primary-soft dark:border-primary/30 bg-primary-soft dark:bg-primary/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <ArrowLeftRight size={16} className="text-primary shrink-0" />
                <span className="truncate font-medium text-ink">
                  {transferQty} × {selectedProduct ? productLabel(selectedProduct) : "items"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-muted">
                <span className="font-medium text-ink">{selectedFrom.path}</span>
                <ArrowRight size={14} className="text-primary" />
                <span className="font-medium text-ink">{toSelected.path}</span>
              </div>
            </div>
          )}
          </div>
        </section>

        {/* 3. Details */}
        <section className="border border-border rounded-xl overflow-hidden">
          <header className="px-5 py-3 bg-app border-b border-border">
            <SectionHeading step={3}>Details</SectionHeading>
          </header>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          className="text-xs font-mono px-2 py-1 rounded border border-border-strong bg-subtle text-ink hover:border-primary hover:text-primary dark:hover:text-primary transition-colors"
                        >
                          {s.serial_number}
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="text-xs text-muted flex items-center gap-1">
                    <Fingerprint size={14} className="text-primary" />
                    Select a source location to see its in-stock serials. Click a serial to add it.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Lot (optional)</label>
                <FittedSelect
                  ariaLabel="Lot"
                  value={lot_id}
                  onChange={setLotId}
                  disabled={!selectedFrom}
                  options={(selectedFrom?.lots || []).map((l) => ({
                    value: String(l.lot_id),
                    label: `${l.lot_number} (${l.quantity})`,
                  }))}
                  placeholder="Any lot"
                />
                {selectedFrom && selectedFrom.lots.length > 0 && (
                  <p className="text-xs text-muted mt-1">Limit the move to one lot from {selectedFrom.path}.</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Notes</label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          </div>
        </section>

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
          <ArrowLeftRight size={14} className="text-primary" />
          A single reference is used for both the outbound and inbound movement.
        </p>
      </form>
    </SlideOver>
  );
}