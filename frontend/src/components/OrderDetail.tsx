import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import api from "../api/client";
import type { Order } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { useToast } from "../context/ToastContext";
import LocationPicker from "./LocationPicker";
import Modal from "./Modal";
import StockLocationHints from "./StockLocationHints";

interface Props {
  order: Order;
  onClose: () => void;
  onUpdated: () => void;
}

function ReceiveLocationHints({
  productId,
  isSerialized,
  selectedPath,
  onSelect,
}: {
  productId: number;
  isSerialized: boolean;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const { locations, isLoading } = useProductStockLocations(productId, isSerialized);
  return (
    <StockLocationHints
      locations={locations}
      isSerialized={isSerialized}
      selectedPath={selectedPath}
      onSelect={onSelect}
      isLoading={isLoading}
    />
  );
}

export default function OrderDetail({ order, onClose, onUpdated }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [serials, setSerials] = useState<Record<number, string>>({});
  const [receiveLocations, setReceiveLocations] = useState<Record<number, string>>({});
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data: locationOptions } = useQuery({
    queryKey: ["locations", "order-picker"],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: 5000 } });
      return (data.items || []) as { id: number; path: string }[];
    },
  });

  const serializedItems = order.items.filter((i) => i.is_serialized);
  const needsSerials = serializedItems.length > 0;

  const printPdf = () => {
    api.get(`/orders/${order.id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  };

  const updateStatus = async (status: string) => {
    setConfirming(null);
    try {
      await api.put(`/orders/${order.id}`, { status });
      addToast(`Order ${status === "received" ? "marked as received" : "cancelled"}`, "success");
      onUpdated();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to update order", "error");
    }
  };

  const handleReceive = async () => {
    setReceiving(false);
    const payload: Record<string, unknown> = { status: "received" };

    const receive_locations: Record<number, number> = {};
    for (const item of order.items) {
      const path = (receiveLocations[item.product_id] || "").trim();
      if (!path) continue;
      const loc = (locationOptions || []).find((l) => l.path === path);
      if (!loc) {
        addToast(`Unknown location for ${item.product_name} - pick from the dropdown`, "error");
        return;
      }
      receive_locations[item.product_id] = loc.id;
    }
    if (Object.keys(receive_locations).length > 0) payload.receive_locations = receive_locations;

    if (needsSerials) {
      const serialPayload: Record<number, string[]> = {};
      let missing = false;
      for (const item of serializedItems) {
        const list = (serials[item.product_id] || "")
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
      addToast(err.response?.data?.detail || "Failed to receive order", "error");
    }
  };

  const confirmLabel = `Are you sure you want to cancel ${order.order_number}?`;

  return (
    <Modal open onClose={onClose} title={order.order_number}>
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
            <p className="font-medium">{new Date(order.created_at).toLocaleDateString()}</p>
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
                    {item.is_serialized && <span className="ml-2 badge-info">serialized</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price, currencySymbol)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.quantity * item.unit_price, currencySymbol)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td colSpan={3} className="px-3 py-2 text-right">Total:</td>
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
              <div key={item.id} className="space-y-1.5">
                <label className="block text-sm text-muted">{item.product_name}</label>
                <LocationPicker
                  value={receiveLocations[item.product_id] || ""}
                  onChange={(v) => setReceiveLocations({ ...receiveLocations, [item.product_id]: v })}
                  placeholder="Location (defaults to product location)"
                />
                <ReceiveLocationHints
                  productId={item.product_id}
                  isSerialized={item.is_serialized}
                  selectedPath={receiveLocations[item.product_id] || ""}
                  onSelect={(p) => setReceiveLocations({ ...receiveLocations, [item.product_id]: p })}
                />
                {item.is_serialized && (
                  <textarea
                    className="input font-mono text-xs"
                    rows={3}
                    value={serials[item.product_id] || ""}
                    onChange={(e) => setSerials({ ...serials, [item.product_id]: e.target.value })}
                    placeholder={`Enter ${item.quantity} serial number(s), one per line`}
                    aria-label={`Serial numbers for ${item.product_name}`}
                  />
                )}
              </div>
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
    </Modal>
  );
}
