import { Printer, Send, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { paymentLabel } from "../utils/payments";
import { statusBadge } from "../utils/statusBadges";
import { useSettings } from "../hooks/useSettings";
import SlideOver from "./SlideOver";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";

interface Props {
  sale: Sale;
  onClose: () => void;
}

export default function SaleDetail({ sale, onClose }: Props) {
  const formatDateTime = useDateTimeFormat();
  const { data: settings } = useSettings();
  const saleSymbol = sale.currency_symbol || settings?.currency_symbol || "$";
  const { addToast } = useToast();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [refundStatus, setRefundStatus] = useState(sale.refund_status);
  const [refundPhone, setRefundPhone] = useState(sale.payment_phone || "");
  const [stkPending, setStkBilling] = useState(false);
  const [b2cPending, setB2cPending] = useState(false);

  const printInvoice = () => {
    api.get(`/sales/${sale.id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => addToast("Failed to generate PDF", "error"));
  };

  const completeRefund = useMutation({
    mutationFn: () => api.put(`/sales/${sale.id}/refund/complete`),
    onSuccess: () => {
      setRefundStatus("completed");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      addToast("Refund marked complete", "success");
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Failed to update refund", "error"),
  });

  const stkPush = useMutation({
    mutationFn: async () => {
      if (!refundPhone.trim()) throw new Error("Enter a phone number");
      setStkBilling(true);
      const { data } = await api.post("/daraja/stk-push", {
        phone: refundPhone.trim(),
        amount: sale.total_amount,
        reference: sale.invoice_number,
        description: `Payment for ${sale.invoice_number}`,
        account_ref: sale.invoice_number,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      if (data.success) {
        addToast("STK Push sent — awaiting customer confirmation", "success");
        api.put(`/sales/${sale.id}/checkout-id`, { checkout_request_id: data.checkout_request_id }).catch(() => {});
      } else {
        addToast(data.message || "STK Push failed", "error");
      }
      setStkBilling(false);
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || err.message || "STK Push failed", "error");
      setStkBilling(false);
    },
  });

  const b2cRefund = useMutation({
    mutationFn: async () => {
      if (!refundPhone.trim()) throw new Error("Enter a phone number for refund");
      setB2cPending(true);
      const { data } = await api.post("/daraja/b2c-refund", {
        phone: refundPhone.trim(),
        amount: sale.total_amount,
        sale_id: sale.id,
        reference: sale.invoice_number,
        remarks: `Refund ${sale.invoice_number}`,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      if (data.success) {
        addToast("B2C refund initiated", "success");
      } else {
        addToast(data.message || "B2C refund failed", "error");
      }
      setB2cPending(false);
    },
    onError: (err: any) => {
      addToast(err.response?.data?.detail || err.message || "B2C refund failed", "error");
      setB2cPending(false);
    },
  });

  const refundBadge = refundStatus === "completed"
    ? "badge-success"
    : refundStatus === "pending"
      ? "badge-warning"
      : "";

  const paymentStatusBadge = sale.payment_status === "completed"
    ? "badge-success"
    : sale.payment_status === "pending"
      ? "badge-warning"
      : sale.payment_status === "failed"
        ? "badge-danger"
        : "";

  const isMpesa = sale.payment_method === "mobile_money" && sale.payment_provider === "m-pesa";

  return (
    <SlideOver open onClose={onClose} title={`Invoice ${sale.invoice_number}`} wide ariaLabel={`Invoice ${sale.invoice_number} details`}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-muted">Customer: <span className="font-medium text-ink">{sale.customer_name}</span></p>
            <p className="text-muted">Date: <span className="font-medium text-ink">{formatDateTime(sale.created_at)}</span></p>
            <p className="text-muted">Cashier: <span className="font-medium text-ink">{sale.username}</span></p>
          </div>
          <div className="space-y-1 text-right">
            <span className={`badge ${statusBadge(sale.status)}`}>{sale.status}</span>
            <p className="text-muted">Payment: <span className="font-medium text-ink">{paymentLabel(sale.payment_method, sale.payment_provider)}</span></p>
            {sale.payment_phone && <p className="text-muted">Payer phone: <span className="font-medium text-ink">{sale.payment_phone}</span></p>}
            {sale.payment_reference && <p className="text-muted">Reference: <span className="font-medium text-ink font-mono">{sale.payment_reference}</span></p>}
            {sale.payment_status && (
              <p className="text-muted">Payment Status: <span className={`badge ${paymentStatusBadge}`}>{sale.payment_status}</span></p>
            )}
            {sale.payment_provider_amount != null && (
              <p className="text-muted">Provider Amount: <span className="font-medium text-ink">{formatCurrency(sale.payment_provider_amount, saleSymbol)}</span></p>
            )}
          </div>
        </div>

        {isMpesa && (sale.status === "completed" || sale.status === "pending") && !sale.refund_status && (
          <div className="bg-subtle border border-border rounded-lg px-4 py-3 space-y-3">
            <p className="text-xs font-medium text-muted uppercase tracking-wide">M-Pesa Actions</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-muted mb-1">Phone (254XXXXXXXXX)</label>
                <input className="input text-sm" value={refundPhone} onChange={(e) => setRefundPhone(e.target.value)} placeholder="e.g. 254712345678" />
              </div>
              <button onClick={() => stkPush.mutate()} disabled={stkPending || !refundPhone.trim()} className="btn-primary text-xs inline-flex items-center gap-1">
                <Send size={13} />
                {stkPending ? "Sending..." : "STK Push"}
              </button>
              <button onClick={() => b2cRefund.mutate()} disabled={b2cPending || !refundPhone.trim()} className="btn-secondary text-xs inline-flex items-center gap-1">
                <RefreshCw size={13} />
                {b2cPending ? "Sending..." : "B2C Refund"}
              </button>
            </div>
          </div>
        )}

        {sale.status === "refunded" && (
          <div className="flex items-center justify-between bg-subtle border border-border rounded-lg px-4 py-3">
            <div className="space-y-1">
              <p className="text-muted">Refund: <span className="font-medium text-ink">
                {sale.refund_method ? paymentLabel(sale.refund_method, sale.refund_provider) : paymentLabel(sale.payment_method, sale.payment_provider)}
              </span></p>
              {refundStatus && <p className="text-muted">Status: <span className={`badge ${refundBadge}`}>{refundStatus}</span></p>}
            </div>
            {refundStatus === "pending" && can("sales.refund") && (
              <button onClick={() => completeRefund.mutate()} disabled={completeRefund.isPending} className="btn-secondary">
                {completeRefund.isPending ? "Updating..." : "Complete Refund"}
              </button>
            )}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app text-left">
              <th scope="col" className="px-3 py-2 font-medium text-muted">Item</th>
              <th scope="col" className="px-3 py-2 font-medium text-muted">Location</th>
              <th scope="col" className="px-3 py-2 font-medium text-muted">Qty</th>
              <th scope="col" className="px-3 py-2 font-medium text-muted">Price</th>
              <th className="px-3 py-2 font-medium text-muted text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">{item.product_name}</td>
                <td className="px-3 py-2 text-muted">{item.location || (item.locations ?? []).join(", ") || "\u2014"}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">{formatCurrency(item.unit_price, saleSymbol)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(item.line_total, saleSymbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-56 space-y-1">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatCurrency(sale.subtotal, saleSymbol)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax</span><span>{formatCurrency(sale.tax_amount, saleSymbol)}</span></div>
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(sale.total_amount, saleSymbol)}</span></div>
          </div>
        </div>

        {sale.notes && <p className="text-muted">Notes: {sale.notes}</p>}

        <div className="flex justify-end pt-2">
          <button onClick={printInvoice} className="btn-secondary">
            <Printer size={16} className="inline mr-1" />
            Print / PDF
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
