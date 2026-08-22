import { useDateFormat } from "../hooks/useDateFormat";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint, Printer } from "lucide-react";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PICKER } from "../utils/constants";
import type { LPN, Order, OrderItem } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";
import LocationPicker from "./LocationPicker";
import SlideOver from "./SlideOver";
import StockLocationHints from "./StockLocationHints";

interface Props {
  order: Order;
  onClose: () => void;
  onUpdated: () => void;
}

interface LocationOption {
  id: number;
  path: string;
}

interface ReceiveEntry {
  location: string;
  lpn_number: string;
  lpn_id?: number;
  lot_number: string;
  expiry_date: string;
  serials: string;
}

const emptyEntry: ReceiveEntry = {
  location: "",
  lpn_number: "",
  lot_number: "",
  expiry_date: "",
  serials: "",
};

function useLocationLpns(locationPath: string, locations: LocationOption[]) {
  const locationId = useMemo(() => {
    if (!locationPath) return undefined;
    return locations.find((l) => l.path === locationPath)?.id;
  }, [locationPath, locations]);

  const { data, isLoading } = useQuery({
    queryKey: ["lpns", "by-location", locationId],
    queryFn: async () => {
      const { data } = await api.get("/lpns", { params: { location_id: locationId, limit: PAGE_SIZE_PICKER } });
      return (data.items || []) as LPN[];
    },
    enabled: !!locationId,
  });
  return { lpns: data ?? [], isLoading };
}

function ReceiveRow({
  item,
  locations,
  globalLpns,
  entry,
  onChange,
}: {
  item: OrderItem;
  locations: LocationOption[];
  globalLpns: LPN[];
  entry: ReceiveEntry;
  onChange: (patch: Partial<ReceiveEntry>) => void;
}) {
  const { locations: stockLocations, isLoading: stockLoading } = useProductStockLocations(item.product_id, item.is_serialized);
  const { lpns, isLoading: lpnsLoading } = useLocationLpns(entry.location, locations);
  const pickerLpns = entry.location ? lpns : globalLpns;

  useEffect(() => {
    if (entry.location) return;
    if (stockLocations.length === 1) {
      onChange({ location: stockLocations[0].path });
    }
  }, [stockLocations]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!entry.location || entry.lpn_number) return;
    if (lpns.length === 1) {
      onChange({ lpn_number: lpns[0].lpn_number, lpn_id: lpns[0].id });
    }
  }, [lpns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!entry.lpn_number || entry.lpn_id) return;
    const match = lpns.find((l) => l.lpn_number === entry.lpn_number);
    if (match) onChange({ lpn_id: match.id });
  }, [lpns]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLocationChange = (v: string) => {
    onChange({ location: v, lpn_number: "", lpn_id: undefined });
  };

  const handleLpnChange = (v: string) => {
    const trimmed = v.trim();
    const fromLocation = lpns.find((l) => l.lpn_number === trimmed);
    const match = fromLocation ?? globalLpns.find((l) => l.lpn_number === trimmed);
    onChange({ lpn_number: v, lpn_id: match?.id });
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-muted">{item.product_name}</label>
      <LocationPicker value={entry.location} onChange={handleLocationChange} placeholder="Location (defaults to product location)" />
      <StockLocationHints
        locations={stockLocations}
        isSerialized={item.is_serialized}
        selectedPath={entry.location}
        onSelect={handleLocationChange}
        isLoading={stockLoading}
      />
      <input
        className="input"
        list={`order-lpn-options-${item.id}`}
        placeholder="LPN (optional)"
        value={entry.lpn_number}
        onChange={(e) => handleLpnChange(e.target.value)}
        aria-label={`LPN for ${item.product_name}`}
      />
      <datalist id={`order-lpn-options-${item.id}`}>
        {pickerLpns.map((l) => (
          <option key={l.id} value={l.lpn_number}>
            {l.content_count === 0 ? "empty pallet" : `${l.total_quantity} units`}
          </option>
        ))}
      </datalist>
      {entry.location && lpnsLoading && <p className="text-xs text-faint mt-1">Loading LPNs...</p>}
      {entry.location && !lpnsLoading && lpns.length === 0 && (
        <p className="text-xs text-faint mt-1">No LPNs at this location - create one to receive onto a pallet</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          className="input"
          placeholder="Lot number (optional)"
          value={entry.lot_number}
          onChange={(e) => onChange({ lot_number: e.target.value })}
          aria-label={`Lot number for ${item.product_name}`}
        />
        <input
          type="date"
          className="input"
          value={entry.expiry_date}
          onChange={(e) => onChange({ expiry_date: e.target.value })}
          aria-label={`Expiry date for ${item.product_name}`}
        />
      </div>
      {item.is_serialized && (
        <textarea
          className="input font-mono text-xs"
          rows={3}
          value={entry.serials}
          onChange={(e) => onChange({ serials: e.target.value })}
          placeholder={`Enter ${item.quantity} serial number(s), one per line`}
          aria-label={`Serial numbers for ${item.product_name}`}
        />
      )}
    </div>
  );
}

export default function OrderDetail({ order, onClose, onUpdated }: Props) {
  const formatDate = useDateFormat();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receiveEntries, setReceiveEntries] = useState<Record<number, ReceiveEntry>>({});
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data: locationOptions } = useQuery({
    queryKey: ["locations", "order-picker"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return (data.items || []) as LocationOption[];
    },
  });

  const { data: lpnOptions } = useQuery({
    queryKey: ["lpns", "order-picker"],
    queryFn: async () => {
      const { data } = await api.get("/lpns", { params: { limit: PAGE_SIZE_LOOKUP } });
      return (data.items || []) as LPN[];
    },
  });

  const serializedItems = order.items.filter((i) => i.is_serialized);
  const needsSerials = serializedItems.length > 0;

  const printPdf = () => {
    api.get(`/orders/${order.id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => addToast("Failed to generate PDF", "error"));
  };

  const updateStatus = async (status: string) => {
    setConfirming(null);
    try {
      await api.put(`/orders/${order.id}`, { status });
      addToast(`Order ${status === "received" ? "marked as received" : "cancelled"}`, "success");
      onUpdated();
    } catch (err: any) {
      addToast(errorMessage(err, "Failed to update order"), "error");
    }
  };

  const handleReceive = async () => {
    setReceiving(false);
    const payload: Record<string, unknown> = { status: "received" };

    const receive_locations: Record<number, number> = {};
    const lot_numbers: Record<number, string> = {};
    const expiry_dates: Record<number, string> = {};
    const lpn_ids: Record<number, number> = {};
    for (const item of order.items) {
      const entry = receiveEntries[item.product_id] || emptyEntry;
      const path = (entry.location || "").trim();
      if (path) {
        const loc = (locationOptions || []).find((l) => l.path === path);
        if (!loc) {
          addToast(`Unknown location for ${item.product_name} - pick from the dropdown`, "error");
          return;
        }
        receive_locations[item.product_id] = loc.id;
      }
      const lot = (entry.lot_number || "").trim();
      if (lot) lot_numbers[item.product_id] = lot;
      const exp = (entry.expiry_date || "").trim();
      if (exp) expiry_dates[item.product_id] = exp;
      const lpn = (entry.lpn_number || "").trim();
      if (lpn) {
        if (!entry.lpn_id) {
          addToast(`Unknown LPN "${lpn}" for ${item.product_name}`, "error");
          return;
        }
        lpn_ids[item.product_id] = entry.lpn_id;
      }
    }
    if (Object.keys(receive_locations).length > 0) payload.receive_locations = receive_locations;
    if (Object.keys(lot_numbers).length > 0) payload.lot_numbers = lot_numbers;
    if (Object.keys(expiry_dates).length > 0) payload.expiry_dates = expiry_dates;
    if (Object.keys(lpn_ids).length > 0) payload.lpn_ids = lpn_ids;

    if (needsSerials) {
      const serialPayload: Record<number, string[]> = {};
      let missing = false;
      for (const item of serializedItems) {
        const entry = receiveEntries[item.product_id] || emptyEntry;
        const list = (entry.serials || "")
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length !== item.quantity) missing = true;
        serialPayload[item.product_id] = list;
      }
      if (missing) {
        addToast(`Enter exactly the ordered quantity of serial numbers for each serialized item`, "error");
        return;
      }
      payload.serial_numbers = serialPayload;
    }

    try {
      await api.put(`/orders/${order.id}`, payload);
      addToast("Order marked as received", "success");
      onUpdated();
    } catch (err: any) {
      addToast(errorMessage(err, "Failed to receive order"), "error");
    }
  };

  const confirmLabel = `Are you sure you want to cancel ${order.order_number}?`;

  return (
    <SlideOver open onClose={onClose} title={order.order_number} wide ariaLabel={`Order ${order.order_number}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted">Supplier:</span>
            <p className="font-medium">{order.supplier_name || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Status:</span>
            <p className="font-medium capitalize">{order.status}</p>
          </div>
          <div>
            <span className="text-muted">Date:</span>
            <p className="font-medium">{formatDate(order.created_at)}</p>
          </div>
          <div>
            <span className="text-muted">Created by:</span>
            <p className="font-medium">{order.username}</p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-ink mb-2">Items</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app">
                <th className="px-3 py-2 text-left text-muted">Product</th>
                <th className="px-3 py-2 text-left text-muted">SKU</th>
                <th className="px-3 py-2 text-right text-muted">Qty</th>
                <th className="px-3 py-2 text-right text-muted">Price</th>
                <th className="px-3 py-2 text-right text-muted">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    {item.product_name}
                    {item.is_serialized && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/30">
                        <Fingerprint size={12} />
                        serialized
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{item.sku || "\u2014"}</td>
                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price, currencySymbol)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.quantity * item.unit_price, currencySymbol)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td colSpan={4} className="px-3 py-2 text-right">Total:</td>
                <td className="px-3 py-2 text-right">{formatCurrency(order.total_amount, currencySymbol)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {order.notes && (
          <div>
            <span className="text-sm text-muted">Notes:</span>
            <p className="text-sm mt-1">{order.notes}</p>
          </div>
        )}

        {receiving && (
          <div className="bg-app rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-ink">Choose a location to receive into (optional - defaults to each product's location)</p>
            {order.items.map((item) => (
              <ReceiveRow
                key={item.id}
                item={item}
                locations={locationOptions || []}
                globalLpns={lpnOptions || []}
                entry={receiveEntries[item.product_id] || emptyEntry}
                onChange={(patch) =>
                  setReceiveEntries((prev) => ({
                    ...prev,
                    [item.product_id]: { ...(prev[item.product_id] || emptyEntry), ...patch },
                  }))
                }
              />
            ))}
            <div className="flex gap-2">
              <button onClick={handleReceive} className="btn-primary text-sm px-3 py-1.5">Receive Order</button>
              <button onClick={() => setReceiving(false)} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={printPdf} className="btn-secondary flex-1 inline-flex items-center justify-center gap-2">
            <Printer size={16} /> Print PDF
          </button>
          {order.status === "pending" && !confirming && !receiving && (
            <>
              <button onClick={() => setReceiving(true)} className="btn-primary flex-1">Mark Received</button>
              <button onClick={() => setConfirming("cancelled")} className="btn-danger flex-1">Cancel Order</button>
            </>
          )}
        </div>

        {confirming && (
          <div className="bg-app rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-ink">{confirmLabel}</p>
            <div className="flex gap-2">
              <button onClick={() => updateStatus(confirming)} className="btn-primary text-sm px-3 py-1.5">Yes, proceed</button>
              <button onClick={() => setConfirming(null)} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </SlideOver>
  );
}
