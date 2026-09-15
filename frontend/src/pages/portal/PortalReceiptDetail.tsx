import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, PackageOpen } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { formatCurrency } from "../../utils/currency";
import Skeleton from "../../components/Skeleton";
import { errorMessage } from "../../utils/errors";
import { useToast } from "../../context/ToastContext";
import type { PortalMe, Receipt } from "../../types";

export default function PortalReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const receiptId = Number(id);
  const formatDate = useDateFormat();
  const { addToast } = useToast();

  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });
  const { data: receipt, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "receipt", receiptId],
    queryFn: async () => (await api.get(`/portal/receipts/${receiptId}`)).data as Receipt,
  });

  const downloadPdf = async () => {
    try {
      const { data } = await api.get(`/portal/receipts/${receiptId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${receipt?.receipt_number ?? "receipt"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  if (isLoading) return <Skeleton variant="rows" rows={6} cols={3} />;
  if (isError || !receipt) {
    return (
      <div className="space-y-4">
        <Link to="/portal/receipts" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to deliveries
        </Link>
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Delivery not found")}
        </div>
      </div>
    );
  }

  const currencySymbol = me?.currency_symbol || "$";

  return (
    <div className="space-y-6">
      <Link to="/portal/receipts" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back to deliveries
      </Link>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink">{receipt.receipt_number}</h1>
            <p className="text-sm text-muted mt-1">
              {me?.supplier.name ?? "Supplier"} · {formatDate(receipt.created_at)}
              {receipt.reference ? ` · ${receipt.reference}` : ""}
            </p>
          </div>
          <button onClick={downloadPdf} className="btn-secondary inline-flex items-center gap-1.5 self-start" aria-label="Download delivery PDF">
            <FileText size={16} /> PDF
          </button>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 border-t border-border pt-5 text-sm">
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Total quantity</dt>
            <dd className="font-semibold text-ink">{receipt.total_quantity}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Total value</dt>
            <dd className="font-semibold text-ink">{formatCurrency(receipt.total_cost, currencySymbol)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Received by</dt>
            <dd className="font-medium text-ink">{receipt.username || "—"}</dd>
          </div>
        </dl>

        {receipt.notes && (
          <p className="text-sm text-muted mt-4 border-t border-border pt-4">{receipt.notes}</p>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <PackageOpen size={16} />
          <h2 className="font-semibold text-ink">Line items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                <th className="px-4 py-2.5 font-medium text-right hidden sm:table-cell">Unit cost</th>
                <th className="px-4 py-2.5 font-medium text-right">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {item.product_image ? (
                        <img src={item.product_image} alt="" className="h-9 w-9 rounded-lg object-cover border border-border shrink-0" loading="lazy" />
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-medium text-ink truncate">{item.product_name}</p>
                        <p className="text-xs text-muted">{item.lot_number || item.location_name || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell">{formatCurrency(item.unit_cost, currencySymbol)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.quantity * item.unit_cost, currencySymbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}