import { Send, RefreshCw, XCircle, Trash2, ExternalLink, Download, Eye, X, Pencil } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { paymentLabel } from "../utils/payments";
import { statusBadge } from "../utils/statusBadges";
import { getPlaceholder, onImageError } from "../utils/placeholders";
import { useSettings } from "../hooks/useSettings";
import SlideOver from "./SlideOver";
import AttachmentSection from "./AttachmentSection";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { errorMessage } from "../utils/errors";

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
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(sale.notes);
  const [currentNote, setCurrentNote] = useState(sale.notes);
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
      window.open(url, "_blank", "noopener,noreferrer");
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
    onError: (err: unknown) => addToast(errorMessage(err, "Failed to update refund"), "error"),
  });

  const saveNote = useMutation({
    mutationFn: (notes: string) => api.put(`/sales/${sale.id}`, { notes }),
    onSuccess: (_data, notes) => {
      setEditingNote(false);
      setCurrentNote(notes);
      setNoteDraft(notes);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      addToast("Sale note saved", "success");
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Failed to save note"), "error"),
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
    onError: (err: unknown) => {
      addToast(errorMessage(err, "STK Push failed"), "error");
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
    onError: (err: unknown) => {
      addToast(errorMessage(err, "B2C refund failed"), "error");
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
    onError: (err: unknown) => addToast(errorMessage(err, "Cancellation failed"), "error"),
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
    onError: (err: unknown) => addToast(errorMessage(err, "Delete failed"), "error"),
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
    <SlideOver
      open
      onClose={onClose}
      title={`Invoice ${sale.invoice_number}`}
      wide
      actions={can("sales.create") && !editingNote ? (
        <button
          onClick={() => { setNoteDraft(currentNote); setEditingNote(true); }}
          className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5"
          aria-label={currentNote ? "Edit note" : "Add note"}
        >
          <Pencil size={14} />{currentNote ? "Edit note" : "Add note"}
        </button>
      ) : undefined}
    >
      <div className="space-y-5 text-sm">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">Sales Invoice</p>
              <h3 className="text-2xl font-bold text-ink mt-1 tracking-tight">{sale.invoice_number}</h3>
              <div className="mt-2"><span className={`badge ${statusBadge(sale.status)}`}>{sale.status}</span></div>
            </div>
            <div className="text-right text-sm">
              <p className="text-muted">Date</p>
              <p className="font-medium text-ink">{formatDateTime(sale.created_at)}</p>
              {sale.username && (
                <p className="text-muted mt-2">Sold by <span className="font-medium text-ink">{sale.username}</span></p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 px-6 py-5 text-sm border-b border-dashed border-border">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Customer</p>
              <p className="font-medium text-ink">{sale.customer_name || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Channel</p>
              <p className="font-medium text-ink">{sale.channel_name || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Cashier</p>
              <p className="font-medium text-ink">{sale.username || "—"}</p>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-faint border-b border-border">
                    <th className="py-2.5 pr-3 text-left font-medium">Item</th>
                    <th className="py-2.5 px-3 text-left font-medium">Location</th>
                    <th className="py-2.5 px-3 text-center font-medium">Qty</th>
                    <th className="py-2.5 px-3 text-right font-medium">Price</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sale.items.map((item) => (
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
                          <span className="font-medium text-ink">{item.product_name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-muted whitespace-nowrap">{item.location || (item.locations ?? []).join(", ") || "\u2014"}</td>
                      <td className="py-3 px-3 text-center text-muted whitespace-nowrap">{item.quantity}</td>
                      <td className="py-3 px-3 text-right text-muted whitespace-nowrap">{formatCurrency(item.unit_price, saleSymbol)}</td>
                      <td className="py-3 pl-3 text-right text-ink font-medium whitespace-nowrap">{formatCurrency(item.line_total, saleSymbol)}</td>
                    </tr>
                  ))}
                  {sale.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted">No items on this invoice</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 pt-5 border-t-2 border-double border-border flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {sale.payment_status && sale.status !== "cancelled" && sale.payment_status !== sale.status && (
                    <p className="text-muted">Payment: <span className={`badge ${paymentStatusBadge}`}>{sale.payment_status}</span></p>
                  )}
                  <p className="text-muted">Method: <span className="font-medium text-ink">{paymentLabel(sale.payment_method, sale.payment_provider)}</span></p>
                  {sale.payment_phone && <p className="text-muted">Payer phone: <span className="font-medium text-ink">{sale.payment_phone}</span></p>}
                  {sale.payment_reference && <p className="text-muted">Reference: <span className="font-medium text-ink font-mono">{sale.payment_reference}</span></p>}
                  {sale.payment_provider_amount != null && (
                    <p className="text-muted">Provider Amount: <span className="font-medium text-ink">{formatCurrency(sale.payment_provider_amount, saleSymbol)}</span></p>
                  )}
                </div>

                <div className="w-full sm:w-72">
                  <div className="rounded-xl border border-border bg-subtle/40 dark:bg-app p-4 space-y-2.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Subtotal</span>
                      <span className="font-medium text-ink">{formatCurrency(sale.subtotal, saleSymbol)}</span>
                    </div>
                    {sale.discount_amount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">Discount</span>
                        <span className="font-medium text-red-600 dark:text-red-400">−{formatCurrency(sale.discount_amount, saleSymbol)}</span>
                      </div>
                    )}
                    {sale.promo_discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">Promo {sale.promo_code ? `(${sale.promo_code})` : ""}</span>
                        <span className="font-medium text-red-600 dark:text-red-400">−{formatCurrency(sale.promo_discount, saleSymbol)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Tax</span>
                      <span className="font-medium text-ink">{formatCurrency(sale.tax_amount, saleSymbol)}</span>
                    </div>
                    <div className="pt-2.5 mt-1 border-t border-dashed border-border flex items-baseline justify-between">
                      <span className="font-semibold text-ink">Total</span>
                      <span className="text-2xl font-bold text-ink tracking-tight">{formatCurrency(sale.total_amount, saleSymbol)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 pb-5 text-sm">
            <div className="flex items-center justify-between gap-3 mb-1">
              <p className="text-faint text-xs uppercase tracking-wide">Notes</p>
            </div>
            {editingNote ? (
              <div className="space-y-2">
                <textarea
                  className="input text-sm w-full"
                  rows={3}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add a note for this sale..."
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingNote(false)} disabled={saveNote.isPending} className="btn-secondary text-xs">
                    Cancel
                  </button>
                  <button onClick={() => saveNote.mutate(noteDraft)} disabled={saveNote.isPending} className="btn-primary text-xs">
                    {saveNote.isPending ? "Saving..." : "Save note"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-muted whitespace-pre-wrap">{currentNote || "No notes on this sale."}</p>
            )}
          </div>
        </div>

        <div className="px-6 py-5 border-t border-border bg-white dark:bg-app">
          <AttachmentSection entityType="sale" entityId={sale.id} canEdit={can("sales.create")} />
        </div>

        {isMpesa && (sale.status === "completed" || sale.status === "pending") && !sale.refund_status && (
          <div className="bg-subtle border border-border rounded-lg px-4 py-3 space-y-3">
            <p className="text-xs font-medium text-muted uppercase tracking-wide">M-Pesa Actions</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-muted mb-1">Phone (254XXXXXXXXX)</label>
                <input className="input text-sm" value={refundPhone} onChange={(e) => setRefundPhone(e.target.value)} placeholder="e.g. 254712345678" />
              </div>
              <button onClick={() => stkPush.mutate()} disabled={stkPending || !refundPhone.trim()} className="btn-primary text-xs inline-flex items-center gap-1 flex-1 sm:flex-none">
                <Send size={13} />
                {stkPending ? "Sending..." : "STK Push"}
              </button>
              <button onClick={() => b2cRefund.mutate()} disabled={b2cPending || !refundPhone.trim()} className="btn-secondary text-xs inline-flex items-center gap-1 flex-1 sm:flex-none">
                <RefreshCw size={13} />
                {b2cPending ? "Sending..." : "B2C Refund"}
              </button>
            </div>
          </div>
        )}

        {sale.status === "refunded" && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-subtle border border-border rounded-lg px-4 py-3">
            <div className="space-y-1">
              <p className="text-muted">Refund: <span className="font-medium text-ink">
                {sale.refund_method ? paymentLabel(sale.refund_method, sale.refund_provider) : paymentLabel(sale.payment_method, sale.payment_provider)}
              </span></p>
              {refundStatus && <p className="text-muted">Status: <span className={`badge ${refundBadge}`}>{refundStatus}</span></p>}
            </div>
            {refundStatus === "pending" && can("sales.refund") && (
              <button onClick={() => completeRefund.mutate()} disabled={completeRefund.isPending} className="btn-secondary flex-1 sm:flex-none">
                {completeRefund.isPending ? "Updating..." : "Complete Refund"}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-2">
            {sale.status === "pending" && can("sales.refund") && (
              <>
                <button onClick={() => setConfirmAction("cancel")} className="btn-danger text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
                  <XCircle size={14} />Cancel
                </button>
                <button onClick={() => setConfirmAction("delete")} className="btn-danger text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
                  <Trash2 size={14} />Delete
                </button>
              </>
            )}
            {sale.status === "cancelled" && can("sales.refund") && (
              <button onClick={() => setConfirmAction("delete")} className="btn-danger text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
                <Trash2 size={14} />Delete
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={previewInvoice} disabled={pdfLoading} className="btn-primary text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
              <Eye size={14} />{pdfLoading ? "Generating..." : "Preview"}
            </button>
            <button onClick={openInNewTab} className="btn-secondary text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
              <ExternalLink size={14} />Open in tab
            </button>
            <button onClick={downloadInvoice} className="btn-secondary text-sm inline-flex items-center gap-1 flex-1 sm:flex-none">
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
    </SlideOver>

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
