import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Eye, Fingerprint, Printer, Pencil, X } from "lucide-react";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP, PAGE_SIZE_PICKER } from "../utils/constants";
import type { LPN, Order, OrderItem } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import Skeleton from "./Skeleton";
import TextArea from "./TextArea";
import AttachmentSection from "./AttachmentSection";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";
import { overdueStatus } from "../utils/date";
import { statusBadge } from "../utils/statusBadges";
import { getPlaceholder, onImageError } from "../utils/placeholders";
import LocationPicker from "./LocationPicker";
import SlideOver from "./SlideOver";
import DatePicker from "./DatePicker";
import StockLocationHints from "./StockLocationHints";
import EmptyState from "./EmptyState";
import { useAuth } from "../context/AuthContext";

interface Props {
  order: Order;
  onClose: () => void;
  onUpdated: () => void;
  onEdit?: () => void;
}

interface LocationOption {
  id: number;
  path: string;
}

interface ReceiveEntry {
  quantity: string;
  location: string;
  lpn_number: string;
  lpn_id?: number;
  lot_number: string;
  expiry_date: string;
  serials: string;
}

const emptyEntry: ReceiveEntry = {
  quantity: "",
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

  const parsedQty = Number.parseInt(entry.quantity, 10);
  const receiveQty = Number.isFinite(parsedQty) && parsedQty >= 1 ? parsedQty : item.quantity;

  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-muted">{item.product_name}</label>
      <div className="flex items-center gap-2">
        <input
          className="input w-28"
          type="number"
          min={1}
          max={item.quantity}
          placeholder={`Qty (${item.quantity})`}
          value={entry.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          aria-label={`Quantity to receive for ${item.product_name}`}
        />
        <span className="text-xs text-faint">of {item.quantity} ordered</span>
      </div>
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
      {entry.location && lpnsLoading && <Skeleton variant="text" className="w-28 h-3 mt-1" />}
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
        <DatePicker
          value={entry.expiry_date}
          onChange={(v) => onChange({ expiry_date: v })}
          ariaLabel={`Expiry date for ${item.product_name}`}
        />
      </div>
      {item.is_serialized && (
        <TextArea
          className="font-mono text-xs"
          rows={3}
          value={entry.serials}
          onChange={(v) => onChange({ serials: v })}
          placeholder={`Enter ${receiveQty} serial number(s), one per line`}
          ariaLabel={`Serial numbers for ${item.product_name}`}
        />
      )}
    </div>
  );
}

export default function OrderDetail({ order, onClose, onUpdated, onEdit }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receiveEntries, setReceiveEntries] = useState<Record<number, ReceiveEntry>>({});
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const formatDateTime = useDateTimeFormat();
  const currencySymbol = settings?.currency_symbol || "$";
  const canApprove = can("orders.approve");

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
  const isOpen = ["pending", "submitted", "approved", "acknowledged", "in_transit"].includes(order.status);
  const expectedStatus = isOpen ? overdueStatus(order.expected_arrival) : null;

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    return () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); };
  }, [pdfPreviewUrl]);

  const fetchPdfBlob = async (): Promise<Blob> => {
    const { data } = await api.get(`/orders/${order.id}/pdf`, { responseType: "blob" });
    return data;
  };

  const previewOrder = async () => {
    setPdfLoading(true);
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
    } catch {
      addToast("Failed to generate PDF", "error");
    } finally {
      setPdfLoading(false);
    }
  };

  const printPdf = async () => {
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  const downloadPdf = async () => {
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order.order_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast("Failed to download PDF", "error");
    }
  };

  const updateStatus = async (status: string) => {
    setConfirming(null);
    try {
      await api.put(`/orders/${order.id}`, { status });
      const labels: Record<string, string> = {
        submitted: "Order submitted for approval",
        approved: "Order approved",
        acknowledged: "Order acknowledged by supplier",
        in_transit: "Order marked in transit",
        received: "marked as received",
        cancelled: "cancelled",
      };
      addToast(`Order ${labels[status] ?? status}`, "success");
      onUpdated();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to update order"), "error");
    }
  };

  const handleReceive = async () => {
    setReceiving(false);
    const payload: Record<string, unknown> = { status: "received" };

    const receive_quantities: Record<number, number> = {};
    for (const item of order.items) {
      const entry = receiveEntries[item.product_id] || emptyEntry;
      const raw = (entry.quantity ?? "").trim();
      const qty = raw === "" ? item.quantity : Number.parseInt(raw, 10);
      if (!Number.isInteger(qty) || qty < 1 || qty > item.quantity) {
        addToast(`Receive quantity for ${item.product_name} must be between 1 and ${item.quantity}`, "error");
        return;
      }
      receive_quantities[item.product_id] = qty;
    }
    const hasPartialReceive = order.items.some((item) => receive_quantities[item.product_id] !== item.quantity);
    if (hasPartialReceive) payload.receive_quantities = receive_quantities;

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
        if (list.length !== receive_quantities[item.product_id]) missing = true;
        serialPayload[item.product_id] = list;
      }
      if (missing) {
        addToast(`Enter exactly the receive quantity of serial numbers for each serialized item`, "error");
        return;
      }
      payload.serial_numbers = serialPayload;
    }

    try {
      await api.put(`/orders/${order.id}`, payload);
      addToast("Order marked as received", "success");
      onUpdated();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to receive order"), "error");
    }
  };

  const confirmLabel =
    confirming === "cancelled"
      ? `Are you sure you want to cancel ${order.order_number}?`
      : confirming === "submitted"
        ? `Submit ${order.order_number} for approval? It will be sent to a manager before the supplier is notified.`
        : `Approve ${order.order_number}? This confirms the order to the supplier.`;

  return (
    <>
    <SlideOver
      open
      onClose={onClose}
      title={order.order_number}
      wide
      ariaLabel={`Order ${order.order_number}`}
actions={
        order.status === "pending" && onEdit ? (
          <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label={`Edit order ${order.order_number}`}>
            <Pencil size={14} />Edit Order
          </button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">Purchase Order</p>
              <h3 className="text-2xl font-bold text-ink mt-1 tracking-tight">{order.order_number}</h3>
              <div className="mt-2"><span className={`badge ${statusBadge(order.status)}`}>{order.status}</span>
                  {order.approved_at && (
                    <span className="ml-2 text-xs text-muted">Approved {order.approver_name ? `by ${order.approver_name}` : ""} · {formatDateTime(order.approved_at)}</span>
                  )}
                </div>
            </div>
            <div className="text-right text-sm space-y-1">
              <div>
                <p className="text-muted">Placed</p>
                <p className="font-medium text-ink">{formatDateTime(order.created_at)}</p>
              </div>
              <div>
                <p className="text-muted">Expected Arrival</p>
                {order.expected_arrival ? (
                  <p className="font-medium text-ink">
                    {formatDateTime(order.expected_arrival)}
                    {expectedStatus === "overdue" && <span className="badge badge-danger ml-1.5">Overdue</span>}
                    {expectedStatus === "due" && <span className="badge badge-warning ml-1.5">Due</span>}
                  </p>
                ) : (
                  <p className="text-muted">—</p>
                )}
              </div>
              {order.received_at && (
                <div>
                  <p className="text-muted">Received</p>
                  <p className="font-medium text-ink">{formatDateTime(order.received_at)}</p>
                </div>
              )}
              {order.username && (
                <p className="text-muted">Created by <span className="font-medium text-ink">{order.username}</span></p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 px-6 py-5 text-sm border-b border-dashed border-border">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Supplier</p>
              <p className="font-medium text-ink">{order.supplier_name || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Items</p>
              <p className="font-medium text-ink">{order.items.length}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Total Qty</p>
              <p className="font-medium text-ink">{order.items.reduce((sum, i) => sum + i.quantity, 0)}</p>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-faint border-b border-border">
                    <th className="py-2.5 pr-3 text-left font-medium">Product</th>
                    <th className="py-2.5 px-3 text-left font-medium">SKU</th>
                    <th className="py-2.5 px-3 text-center font-medium">Qty</th>
                    <th className="py-2.5 px-3 text-center font-medium">Received</th>
                    <th className="py-2.5 px-3 text-right font-medium">Price</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.product_image || getPlaceholder()}
                            alt=""
                            className="w-10 h-10 rounded object-cover shrink-0 border border-border bg-subtle"
                            loading="lazy"
                            onError={onImageError}
                          />
                          <span className="font-medium text-ink">
                            {item.product_name}
                            {item.is_serialized && (
                              <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/30">
                                <Fingerprint size={12} />
                                serialized
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-muted whitespace-nowrap">{item.sku || "\u2014"}</td>
                      <td className="py-3 px-3 text-center text-muted whitespace-nowrap">{item.quantity}</td>
                      <td className="py-3 px-3 text-center text-muted whitespace-nowrap">{item.received_qty > 0 ? item.received_qty : "\u2014"}</td>
                      <td className="py-3 px-3 text-right text-muted whitespace-nowrap">{formatCurrency(item.unit_price, currencySymbol)}</td>
                      <td className="py-3 pl-3 text-right text-ink font-medium whitespace-nowrap">{formatCurrency(item.quantity * item.unit_price, currencySymbol)}</td>
                    </tr>
                  ))}
                  {order.items.length === 0 && (
                    <EmptyState title="No items on this order" message="Line items will appear here once this order is saved." />
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-5 border-t-2 border-double border-border pt-4 flex justify-end">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-faint">Total Amount</p>
                <p className="text-2xl font-bold text-ink">{formatCurrency(order.total_amount, currencySymbol)}</p>
              </div>
            </div>
          </div>

          {order.notes && (
            <div className="px-6 pb-5 text-sm">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted">{order.notes}</p>
            </div>
          )}

          {(order.supplier_delivery_notes || order.supplier_instructions) && (
            <div className="px-6 pb-5 text-sm space-y-3">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Supplier notes</p>
              {order.supplier_delivery_notes && (
                <div>
                  <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Delivery notes</p>
                  <p className="text-muted whitespace-pre-wrap">{order.supplier_delivery_notes}</p>
                </div>
              )}
              {order.supplier_instructions && (
                <div>
                  <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Special instructions</p>
                  <p className="text-muted whitespace-pre-wrap">{order.supplier_instructions}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {receiving && (
          <div className="bg-app rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-ink">Receive into location and quantity (defaults to the full ordered quantity per line)</p>
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

        <div className="flex flex-wrap gap-3 pt-2">
          {order.status !== "pending" && (
            <button onClick={previewOrder} disabled={pdfLoading} className="btn-primary flex-1 min-w-[120px] inline-flex items-center justify-center gap-2">
              <Eye size={16} />{pdfLoading ? "Generating..." : "Preview"}
            </button>
          )}
          <button onClick={printPdf} className="btn-secondary flex-1 min-w-[120px] inline-flex items-center justify-center gap-2">
            <Printer size={16} /> Print PDF
          </button>
          {order.status === "pending" && !confirming && !receiving && (
            <>
              <button onClick={() => setReceiving(true)} className="btn-primary flex-1 min-w-[120px]">Mark Received</button>
              <button onClick={() => setConfirming("submitted")} className="btn-secondary flex-1 min-w-[120px]">Submit for Approval</button>
              <button onClick={() => setConfirming("cancelled")} className="btn-danger flex-1 min-w-[120px]">Cancel Order</button>
            </>
          )}
          {order.status === "submitted" && !confirming && !receiving && (
            <>
              {canApprove ? (
                <button onClick={() => setConfirming("approved")} className="btn-primary flex-1 min-w-[120px]">Approve Order</button>
              ) : (
                <p className="text-sm text-muted flex-1 min-w-[120px] self-center">Waiting for a manager to approve this order.</p>
              )}
              <button onClick={() => setConfirming("cancelled")} className="btn-danger flex-1 min-w-[120px]">Cancel Order</button>
            </>
          )}
          {order.status === "approved" && !confirming && !receiving && (
            <>
              <button onClick={() => updateStatus("acknowledged")} className="btn-secondary flex-1 min-w-[120px]">Mark Acknowledged</button>
              <button onClick={() => updateStatus("in_transit")} className="btn-secondary flex-1 min-w-[120px]">Mark In Transit</button>
              <button onClick={() => setReceiving(true)} className="btn-primary flex-1 min-w-[120px]">Mark Received</button>
              <button onClick={() => setConfirming("cancelled")} className="btn-danger flex-1 min-w-[120px]">Cancel Order</button>
            </>
          )}
          {order.status === "acknowledged" && !confirming && !receiving && (
            <>
              <button onClick={() => updateStatus("in_transit")} className="btn-secondary flex-1 min-w-[120px]">Mark In Transit</button>
              <button onClick={() => setReceiving(true)} className="btn-primary flex-1 min-w-[120px]">Mark Received</button>
              <button onClick={() => setConfirming("cancelled")} className="btn-danger flex-1 min-w-[120px]">Cancel Order</button>
            </>
          )}
          {order.status === "in_transit" && !confirming && !receiving && (
            <>
              <button onClick={() => setReceiving(true)} className="btn-primary flex-1 min-w-[120px]">Mark Received</button>
              <button onClick={() => setConfirming("cancelled")} className="btn-danger flex-1 min-w-[120px]">Cancel Order</button>
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

        <AttachmentSection entityType="order" entityId={order.id} canEdit={can("orders.update")} />
      </div>
    </SlideOver>

    {pdfPreviewUrl && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }}>
        <div className="bg-surface rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="font-bold text-ink">{order.order_number} — Preview</h3>
            <button onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }} className="text-faint hover:text-muted p-1" aria-label="Close preview">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-2">
            <iframe src={pdfPreviewUrl} className="w-full h-full min-h-[600px] rounded border border-border" title={`PDF preview of ${order.order_number}`} />
          </div>
          <div className="flex justify-end gap-2 px-6 py-3 border-t border-border">
            <button onClick={printPdf} className="btn-secondary text-sm inline-flex items-center gap-1"><ExternalLink size={14} />Open in tab</button>
            <button onClick={downloadPdf} className="btn-primary text-sm inline-flex items-center gap-1"><Download size={14} />Download</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
