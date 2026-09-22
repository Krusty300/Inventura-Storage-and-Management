import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCheck, Truck, FileText, Loader2, Clock, Save, ClipboardList } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { formatCurrency } from "../../utils/currency";
import { statusBadge } from "../../utils/statusBadges";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import TextArea from "../../components/TextArea";
import { errorMessage } from "../../utils/errors";
import { useToast } from "../../context/ToastContext";
import type { Order, PortalMe } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  acknowledged: "Acknowledged",
  in_transit: "In transit",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

interface PortalSettings {
  supplier_id: number;
  supplier_name: string;
  preferences: Record<string, unknown>;
}

export default function PortalOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);
  const formatDate = useDateFormat();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });
  const { data: settingsData } = useQuery({
    queryKey: ["portal", "settings"],
    queryFn: async () => (await api.get("/portal/settings")).data as PortalSettings,
  });
  const { data: order, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "order", orderId],
    queryFn: async () => (await api.get(`/portal/orders/${orderId}`)).data as Order,
  });

  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notesTouched, setNotesTouched] = useState(false);
  useEffect(() => {
    if (order) {
      setDeliveryNotes(order.supplier_delivery_notes || "");
      setInstructions(order.supplier_instructions || "");
      setNotesTouched(false);
    }
  }, [order]);

  const patchMutation = useMutation({
    mutationFn: (status: string) => api.patch(`/portal/orders/${orderId}`, { status }),
    onSuccess: (_data, status) => {
      addToast(`Order marked as ${STATUS_LABEL[status] ?? status}`, "success");
      queryClient.invalidateQueries({ queryKey: ["portal", "order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["portal", "orders"] });
      // Marking a PO in transit auto-raises an ASN server-side, so the
      // shipment lists must refresh too.
      queryClient.invalidateQueries({ queryKey: ["portal", "asns"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "summary"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "me"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Failed to update order"), "error"),
  });

  const saveNotesMutation = useMutation({
    mutationFn: () =>
      api.put(`/portal/orders/${orderId}/notes`, {
        delivery_notes: deliveryNotes,
        instructions,
      }),
    onSuccess: () => {
      addToast("Delivery notes saved", "success");
      setNotesTouched(false);
      queryClient.invalidateQueries({ queryKey: ["portal", "order", orderId] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Failed to save notes"), "error"),
  });

  const downloadPdf = async () => {
    try {
      const { data } = await api.get(`/portal/orders/${orderId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order?.order_number ?? "purchase-order"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  if (isLoading) return <Skeleton variant="rows" rows={6} cols={3} />;
  if (isError || !order) {
    return (
      <div className="space-y-4">
        <Link to="/portal/orders" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to orders
        </Link>
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Order not found")}
        </div>
      </div>
    );
  }

  const currencySymbol = me?.currency_symbol || "$";
  const canAcknowledge = order.status === "approved";
  const canTransit = order.status === "acknowledged";

  return (
    <div className="space-y-6">
      <Link to="/portal/orders" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back to orders
      </Link>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-ink">{order.order_number}</h1>
              <span className={`badge ${statusBadge(order.status)}`}>{STATUS_LABEL[order.status] ?? order.status}</span>
            </div>
            <p className="text-sm text-muted mt-1">{me?.supplier.name ?? "Supplier"} · {formatDate(order.created_at)}</p>
            {Boolean(settingsData?.preferences?.show_lead_time) && me?.supplier?.lead_time_days != null && (
              <p className="text-sm text-muted mt-1 inline-flex items-center gap-1">
                <Clock size={14} /> Estimated lead time: {me.supplier.lead_time_days} day{me.supplier.lead_time_days === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadPdf} className="btn-secondary inline-flex items-center gap-1.5" aria-label="Download order PDF">
              <FileText size={16} /> PDF
            </button>
            {canAcknowledge && (
              <button
                onClick={() => patchMutation.mutate("acknowledged")}
                disabled={patchMutation.isPending}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                {patchMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                Acknowledge
              </button>
            )}
            {canTransit && (
              <button
                onClick={() => patchMutation.mutate("in_transit")}
                disabled={patchMutation.isPending}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                {patchMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
                Mark in transit
              </button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 border-t border-border pt-5 text-sm">
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Order total</dt>
            <dd className="font-semibold text-ink">{formatCurrency(order.total_amount, currencySymbol)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Expected arrival</dt>
            <dd className="font-medium text-ink">{order.expected_arrival ? formatDate(order.expected_arrival) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Received</dt>
            <dd className="font-medium text-ink">{order.received_at ? formatDate(order.received_at) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Items</dt>
            <dd className="font-medium text-ink">{order.items.reduce((n, i) => n + i.quantity, 0)}</dd>
          </div>
        </dl>

        {order.notes && (
          <p className="text-sm text-muted mt-4 border-t border-border pt-4">{order.notes}</p>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-ink">Delivery notes & special instructions</h2>
        <p className="text-sm text-muted mt-0.5">
          Add delivery notes or special instructions for the buyer team to see when this order is received.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Delivery notes</label>
            <TextArea
              rows={3}
              ariaLabel="Delivery notes"
              placeholder="e.g. pallet count, carrier, dock contact"
              value={deliveryNotes}
              maxLength={2000}
              onChange={(v) => {
                setDeliveryNotes(v);
                setNotesTouched(true);
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Special instructions</label>
            <TextArea
              rows={3}
              ariaLabel="Special instructions"
              placeholder="e.g. fragile, cold-chain, unload details"
              value={instructions}
              maxLength={2000}
              onChange={(v) => {
                setInstructions(v);
                setNotesTouched(true);
              }}
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={() => saveNotesMutation.mutate()}
            disabled={!notesTouched || saveNotesMutation.isPending}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            {saveNotesMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save notes
          </button>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-ink">Line items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                <th className="px-4 py-2.5 font-medium text-right hidden sm:table-cell">Unit price</th>
                <th className="px-4 py-2.5 font-medium text-right">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.length === 0 ? (
                <EmptyState variant="table" icon={<ClipboardList size={40} />} title="No line items" message="This purchase order has no line items yet." />
              ) : (
                order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.product_image ? (
                          <img src={item.product_image} alt="" className="h-9 w-9 rounded-lg object-cover border border-border shrink-0" loading="lazy" />
                        ) : null}
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate">{item.product_name}</p>
                          <p className="text-xs text-muted">{item.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">{formatCurrency(item.unit_price, currencySymbol)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.quantity * item.unit_price, currencySymbol)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}