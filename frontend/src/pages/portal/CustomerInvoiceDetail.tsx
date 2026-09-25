import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Receipt, Smartphone } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { formatCurrency } from "../../utils/currency";
import { statusBadge } from "../../utils/statusBadges";
import { paymentLabel, providerLabel } from "../../utils/payments";
import { errorMessage } from "../../utils/errors";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { useToast } from "../../context/ToastContext";
import type { CustomerPortalMe, Sale } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default function CustomerInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const formatDate = useDateFormat();
  const { addToast } = useToast();

  const { data: me } = useQuery({
    queryKey: ["customer", "me"],
    queryFn: async () => (await api.get("/customer/me")).data as CustomerPortalMe,
  });
  const { data: sale, isLoading, isError, error } = useQuery({
    queryKey: ["customer", "sale", invoiceId],
    queryFn: async () => (await api.get(`/customer/sales/${invoiceId}`)).data as Sale,
  });

  const queryClient = useQueryClient();
  const stkMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/customer/checkout/${invoiceId}/stk`);
      return data as { success: boolean; message: string };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["customer", "sale", invoiceId] });
      addToast(
        res.success
          ? "Payment prompt sent — check your phone"
          : (res.message || "Payment prompt could not be sent"),
        res.success ? "success" : "error",
      );
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Payment prompt could not be sent"), "error"),
  });

  const awaitingMobileMoney = sale?.payment_method === "mobile_money" && sale.status === "pending" && sale.payment_status === "pending";

  const downloadPdf = async () => {
    try {
      const { data } = await api.get(`/customer/sales/${invoiceId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sale?.invoice_number ?? "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate invoice PDF", "error");
    }
  };

  if (isLoading) return <Skeleton variant="rows" rows={6} cols={3} />;
  if (isError || !sale) {
    return (
      <div className="space-y-4">
        <Link to="/portal/invoices" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to invoices
        </Link>
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Invoice not found")}
        </div>
      </div>
    );
  }

  const currencySymbol = sale.currency_symbol || me?.currency_symbol || "$";

  return (
    <div className="space-y-6">
      <Link to="/portal/invoices" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back to invoices
      </Link>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink">{sale.invoice_number}</h1>
            <p className="text-sm text-muted mt-1">
              {me?.customer.name ?? "Customer"} · {formatDate(sale.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start">
            <span className={`badge ${statusBadge(sale.status)}`}>{STATUS_LABEL[sale.status] ?? sale.status}</span>
            <button onClick={downloadPdf} className="btn-secondary inline-flex items-center gap-1.5" aria-label="Download invoice PDF">
              <FileText size={16} /> PDF
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 border-t border-border pt-5 text-sm">
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Payment method</dt>
            <dd className="font-semibold text-ink">{paymentLabel(sale.payment_method ?? "", sale.payment_provider)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Payment status</dt>
            <dd className="font-medium text-ink">{sale.payment_status || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Issued by</dt>
            <dd className="font-medium text-ink">{sale.username || "—"}</dd>
          </div>
          {sale.payment_method === "mobile_money" && sale.payment_phone && (
            <div>
              <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Payment phone</dt>
              <dd className="font-medium text-ink">{sale.payment_phone}</dd>
            </div>
          )}
          {sale.payment_method === "mobile_money" && sale.payment_provider && (
            <div>
              <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Provider</dt>
              <dd className="font-medium text-ink">{providerLabel(sale.payment_provider)}</dd>
            </div>
          )}
        </dl>

        {awaitingMobileMoney && (
          <div className="mt-4 border-t border-border pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted flex items-start gap-2">
              <Smartphone size={16} className="mt-0.5 shrink-0" />
              <span>This order is awaiting the mobile money prompt. Approve the payment on your phone to complete it.</span>
            </p>
            <button
              onClick={() => stkMutation.mutate()}
              disabled={stkMutation.isPending}
              className="btn-primary inline-flex items-center gap-1.5 shrink-0 justify-center"
            >
              {stkMutation.isPending ? (
                <><span className="h-4 w-4 rounded bg-white/40 animate-pulse" /> Sending prompt...</>
              ) : (
                <><Smartphone size={16} /> Resend payment prompt</>
              )}
            </button>
          </div>
        )}

        {sale.notes && (
          <p className="text-sm text-muted mt-4 border-t border-border pt-4">{sale.notes}</p>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Receipt size={16} />
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
              {sale.items.length === 0 ? (
                <EmptyState variant="table" icon={<Receipt size={40} />} title="No line items" message="This invoice has no line items recorded." />
              ) : (
                sale.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium text-ink">{item.product_name || `Product #${item.product_id}`}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">{formatCurrency(item.unit_price, currencySymbol)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.line_total, currencySymbol)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5 max-w-md ml-auto w-full">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="font-medium text-ink">{formatCurrency(sale.subtotal, currencySymbol)}</dd>
          </div>
          {sale.discount_amount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Discount</dt>
              <dd className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(sale.discount_amount, currencySymbol)}</dd>
            </div>
          )}
          {sale.tax_amount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Tax</dt>
              <dd className="font-medium text-ink">{formatCurrency(sale.tax_amount, currencySymbol)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2">
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="font-bold text-ink">{formatCurrency(sale.total_amount, currencySymbol)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}