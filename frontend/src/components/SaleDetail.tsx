import { Send, RefreshCw, XCircle, Trash2, ExternalLink, Download, Eye, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { paymentLabel } from "../utils/payments";
import { statusBadge } from "../utils/statusBadges";
import { useSettings } from "../hooks/useSettings";
import Modal from "./Modal";
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
  const [confirmAction, setConfirmAction] = useState<"cancel" | "delete" | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    return () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); };
  }, [pdfPreviewUrl]);

  const fetchPdfBlob = async (): Promise<Blob> => {
    const { data } = await api.get(`/sales/${sale.id}/pdf`, { responseType: "blob" });
    return data;
  };

  const previewInvoice = async () => {
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

  const openInNewTab = async () => {
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  const downloadInvoice = async () => {
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sale.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast("Failed to download PDF", "error");
    }
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

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/sales/${sale.id}/cancel`),
    onSuccess: () => {
      addToast("Sale cancelled, stock restored", "success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Cancellation failed", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/sales/${sale.id}`),
    onSuccess: () => {
      addToast("Sale deleted, stock restored", "success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Delete failed", "error"),
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
    <>
    <Modal open onClose={onClose} title={`Invoice ${sale.invoice_number}`} xwide>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-muted">Customer: <span className="font-medium text-ink">{sale.customer_name}</span></p>
            {sale.channel_name && <p className="text-muted">Channel: <span className="font-medium text-ink">{sale.channel_name}</span></p>}
            <p className="text-muted">Date: <span className="font-medium text-ink">{formatDateTime(sale.created_at)}</span></p>
            <p className="text-muted">Cashier: <span className="font-medium text-ink">{sale.username}</span></p>
          </div>
          <div className="space-y-1 text-right">
            <span className={`badge ${statusBadge(sale.status)}`}>{sale.status}</span>
            <p className="text-muted">Payment: <span className="font-medium text-ink">{paymentLabel(sale.payment_method, sale.payment_provider)}</span></p>
            {sale.payment_phone && <p className="text-muted">Payer phone: <span className="font-medium text-ink">{sale.payment_phone}</span></p>}
            {sale.payment_reference && <p className="text-muted">Reference: <span className="font-medium text-ink font-mono">{sale.payment_reference}</span></p>}
            {sale.payment_status && sale.status !== "cancelled" && sale.payment_status !== sale.status && (
              <p className="text-muted">Payment: <span className={`badge ${paymentStatusBadge}`}>{sale.payment_status}</span></p>
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
            {sale.discount_amount > 0 && <div className="flex justify-between"><span className="text-muted">Discount</span><span className="text-red-600 dark:text-red-400">-{formatCurrency(sale.discount_amount, saleSymbol)}</span></div>}
            {sale.promo_discount > 0 && <div className="flex justify-between"><span className="text-muted">Promo ({sale.promo_code})</span><span className="text-red-600 dark:text-red-400">-{formatCurrency(sale.promo_discount, saleSymbol)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">Tax</span><span>{formatCurrency(sale.tax_amount, saleSymbol)}</span></div>
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(sale.total_amount, saleSymbol)}</span></div>
          </div>
        </div>

        {sale.notes && <p className="text-muted">Notes: {sale.notes}</p>}

        <div className="flex justify-between pt-2">
          <div className="flex gap-2">
            {sale.status === "pending" && can("sales.refund") && (
              <>
                <button onClick={() => setConfirmAction("cancel")} className="btn-danger text-sm inline-flex items-center gap-1">
                  <XCircle size={14} />Cancel
                </button>
                <button onClick={() => setConfirmAction("delete")} className="btn-danger text-sm inline-flex items-center gap-1">
                  <Trash2 size={14} />Delete
                </button>
              </>
            )}
            {sale.status === "cancelled" && can("sales.refund") && (
              <button onClick={() => setConfirmAction("delete")} className="btn-danger text-sm inline-flex items-center gap-1">
                <Trash2 size={14} />Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={previewInvoice} disabled={pdfLoading} className="btn-primary text-sm inline-flex items-center gap-1">
              <Eye size={14} />{pdfLoading ? "Generating..." : "Preview"}
            </button>
            <button onClick={openInNewTab} className="btn-secondary text-sm inline-flex items-center gap-1">
              <ExternalLink size={14} />Open in tab
            </button>
            <button onClick={downloadInvoice} className="btn-secondary text-sm inline-flex items-center gap-1">
              <Download size={14} />Download
            </button>
          </div>
        </div>

        {confirmAction && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
            <div className="card p-6 max-w-sm w-full space-y-4">
              <h3 className="font-bold text-ink">{confirmAction === "cancel" ? "Cancel Sale" : "Delete Sale"}</h3>
              <p className="text-sm text-muted">
                {confirmAction === "cancel"
                  ? `Cancel invoice "${sale.invoice_number}" and restore stock?`
                  : sale.status === "cancelled"
                    ? `Permanently delete cancelled invoice "${sale.invoice_number}"? Stock was already restored. This cannot be undone.`
                    : `Permanently delete invoice "${sale.invoice_number}" and restore stock? This cannot be undone.`}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmAction(null)} className="btn-secondary text-sm">Back</button>
                <button onClick={() => {
                  if (confirmAction === "cancel") cancelMutation.mutate();
                  else deleteMutation.mutate();
                  setConfirmAction(null);
                }} className="btn-danger text-sm" disabled={cancelMutation.isPending || deleteMutation.isPending}>
                  {confirmAction === "cancel" ? "Cancel Sale" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>

    {pdfPreviewUrl && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }}>
        <div className="bg-surface rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="font-bold text-ink">{sale.invoice_number} — Preview</h3>
            <button onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }} className="text-faint hover:text-muted p-1" aria-label="Close preview">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-2">
            <iframe src={pdfPreviewUrl} className="w-full h-full min-h-[600px] rounded border border-border" title={`PDF preview of ${sale.invoice_number}`} />
          </div>
          <div className="flex justify-end gap-2 px-6 py-3 border-t border-border">
            <button onClick={openInNewTab} className="btn-secondary text-sm inline-flex items-center gap-1"><ExternalLink size={14} />Open in tab</button>
            <button onClick={downloadInvoice} className="btn-primary text-sm inline-flex items-center gap-1"><Download size={14} />Download</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
