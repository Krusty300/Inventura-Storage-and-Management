import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, PackageCheck } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { formatCurrency } from "../../utils/currency";
import { statusBadge } from "../../utils/statusBadges";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { errorMessage } from "../../utils/errors";
import { useToast } from "../../context/ToastContext";
import type { ASN, PortalMe } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  received: "Received",
  cancelled: "Cancelled",
};

export default function PortalASNDetail() {
  const { id } = useParams<{ id: string }>();
  const asnId = Number(id);
  const formatDate = useDateFormat();
  const { addToast } = useToast();

  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });
  const { data: asn, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "asn", asnId],
    queryFn: async () => (await api.get(`/portal/asns/${asnId}`)).data as ASN,
  });

  const downloadPdf = async () => {
    try {
      const { data } = await api.get(`/portal/asns/${asnId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${asn?.asn_number ?? "shipping-notice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate PDF", "error");
    }
  };

  if (isLoading) return <Skeleton variant="rows" rows={6} cols={3} />;
  if (isError || !asn) {
    return (
      <div className="space-y-4">
        <Link to="/portal/asns" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Back to shipments
        </Link>
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Shipment not found")}
        </div>
      </div>
    );
  }

  const currencySymbol = me?.currency_symbol || "$";

  return (
    <div className="space-y-6">
      <Link to="/portal/asns" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back to shipments
      </Link>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-ink">{asn.asn_number}</h1>
              <span className={`badge ${statusBadge(asn.status)}`}>{STATUS_LABEL[asn.status] ?? asn.status}</span>
            </div>
            <p className="text-sm text-muted mt-1">
              {me?.supplier.name ?? "Supplier"} · {formatDate(asn.created_at)}
              {asn.order_number && (
                <span className="inline-flex items-center gap-1">· PO <span className="font-medium">{asn.order_number}</span></span>
              )}
            </p>
          </div>
          <button onClick={downloadPdf} className="btn-secondary inline-flex items-center gap-1.5 self-start" aria-label="Download shipment PDF">
            <FileText size={16} /> PDF
          </button>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 border-t border-border pt-5 text-sm">
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Expected arrival</dt>
            <dd className="font-medium text-ink">{asn.expected_arrival ? formatDate(asn.expected_arrival) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Expected qty</dt>
            <dd className="font-medium text-ink">{asn.total_expected}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Received qty</dt>
            <dd className="font-medium text-ink">{asn.total_received}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Received</dt>
            <dd className="font-medium text-ink">{asn.received_at ? formatDate(asn.received_at) : "—"}</dd>
          </div>
        </dl>

        {asn.notes && (
          <p className="text-sm text-muted mt-4 border-t border-border pt-4">{asn.notes}</p>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <PackageCheck size={16} />
          <h2 className="font-semibold text-ink">Line items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium text-right">Expected</th>
                <th className="px-4 py-2.5 font-medium text-right">Received</th>
                <th className="px-4 py-2.5 font-medium text-right hidden sm:table-cell">Unit cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {asn.items.length === 0 ? (
                <EmptyState variant="table" icon={<PackageCheck size={40} />} title="No line items" message="This shipment has no line items yet." />
              ) : (
                asn.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink truncate">{item.product_name}</p>
                        <p className="text-xs text-muted">{item.location_name || "No location"}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{item.expected_qty}</td>
                    <td className="px-4 py-3 text-right">{item.received_qty}</td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">{formatCurrency(item.unit_cost, currencySymbol)}</td>
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