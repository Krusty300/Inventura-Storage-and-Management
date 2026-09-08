import { useEffect, useState } from "react";
import { Download, ExternalLink, Eye, Printer, X } from "lucide-react";
import type { Receipt } from "../types";
import SlideOver from "./SlideOver";
import AttachmentSection from "./AttachmentSection";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { getPlaceholder, onImageError } from "../utils/placeholders";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";
import { useToast } from "../context/ToastContext";

interface Props {
  receipt: Receipt;
  onClose: () => void;
}

export default function ReceiptDetail({ receipt, onClose }: Props) {
  const formatDateTime = useDateTimeFormat();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { addToast } = useToast();
  const total = receipt.items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    return () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); };
  }, [pdfPreviewUrl]);

  const fetchPdfBlob = async (): Promise<Blob> => {
    const { data } = await api.get(`/receipts/${receipt.id}/pdf`, { responseType: "blob" });
    return data;
  };

  const previewReceipt = async () => {
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
      a.download = `${receipt.receipt_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      addToast("Failed to download PDF", "error");
    }
  };

  return (
    <>
      <SlideOver open onClose={onClose} title={`Receipt ${receipt.receipt_number}`} wide>
        <div className="space-y-5">
          <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
            <div className="border-b border-border px-6 py-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-faint">Goods Receipt Note</p>
                <h3 className="text-2xl font-bold text-ink mt-1 tracking-tight">{receipt.receipt_number}</h3>
              </div>
              <div className="text-right text-sm">
                <p className="text-muted">Date</p>
                <p className="font-medium text-ink">{formatDateTime(receipt.created_at)}</p>
                {receipt.username && (
                  <p className="text-muted mt-2">Received by <span className="font-medium text-ink">{receipt.username}</span></p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 px-6 py-5 text-sm border-b border-dashed border-border">
              <div>
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Supplier</p>
                <p className="font-medium text-ink">{receipt.supplier_name || "—"}</p>
              </div>
              <div>
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Reference</p>
                <p className="font-medium text-ink">{receipt.reference || "—"}</p>
              </div>
              <div>
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Lines</p>
                <p className="font-medium text-ink">{receipt.items.length}</p>
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-faint border-b border-border">
                      <th className="py-2.5 pr-3 text-left font-medium">Item</th>
                      <th className="py-2.5 px-3 font-medium">Qty</th>
                      <th className="py-2.5 px-3 text-right font-medium">Unit Cost</th>
                      <th className="py-2.5 px-3 text-right font-medium">Amount</th>
                      <th className="py-2.5 px-3 text-right font-medium">Lot</th>
                      <th className="py-2.5 pl-3 text-right font-medium">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {receipt.items.map((item) => (
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
                        <td className="py-3 px-3 text-center text-muted whitespace-nowrap">{item.quantity}</td>
                        <td className="py-3 px-3 text-right text-muted whitespace-nowrap">{formatCurrency(item.unit_cost, currencySymbol)}</td>
                        <td className="py-3 px-3 text-right text-ink font-medium whitespace-nowrap">{formatCurrency(item.unit_cost * item.quantity, currencySymbol)}</td>
                        <td className="py-3 px-3 text-right text-muted whitespace-nowrap">{item.lot_number || "\u2014"}</td>
                        <td className="py-3 pl-3 text-right text-muted whitespace-nowrap">{item.location_name || "\u2014"}</td>
                      </tr>
                    ))}
                    {receipt.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted">No items on this receipt</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 border-t-2 border-double border-border pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="text-sm text-muted">
                  Total quantity: <span className="font-semibold text-ink">{receipt.total_quantity}</span>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-faint">Total Cost</p>
                  <p className="text-2xl font-bold text-ink">{formatCurrency(total, currencySymbol)}</p>
                </div>
              </div>
            </div>

            {receipt.notes && (
              <div className="px-6 pb-5 text-sm">
                <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
                <p className="text-muted">{receipt.notes}</p>
              </div>
            )}

            <div className="px-6 py-5 border-t border-border">
              <AttachmentSection entityType="receipt" entityId={receipt.id} canEdit={can("receipts.create")} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={previewReceipt} disabled={pdfLoading} className="btn-primary flex-1 inline-flex items-center justify-center gap-2">
              <Eye size={16} />{pdfLoading ? "Generating..." : "Preview"}
            </button>
            <button onClick={printPdf} className="btn-secondary flex-1 inline-flex items-center justify-center gap-2">
              <Printer size={16} /> Print PDF
            </button>
          </div>
        </div>
      </SlideOver>

      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }}>
          <div className="bg-surface rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-bold text-ink">{receipt.receipt_number} — Preview</h3>
              <button onClick={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }} className="text-faint hover:text-muted p-1" aria-label="Close preview">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-2">
              <iframe src={pdfPreviewUrl} className="w-full h-full min-h-[600px] rounded border border-border" title={`PDF preview of ${receipt.receipt_number}`} />
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