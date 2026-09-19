import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardList, PackageOpen, CircleDollarSign, Truck, PackageCheck, Package } from "lucide-react";
import api from "../../api/client";
import { useDateFormat } from "../../hooks/useDateFormat";
import { formatCurrency } from "../../utils/currency";
import { statusBadge } from "../../utils/statusBadges";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import StatCard, { KpiGrid } from "../../components/StatCard";
import { errorMessage } from "../../utils/errors";
import { entityImageUrl } from "../../utils/images";
import { onImageError } from "../../utils/placeholders";
import type { PortalMe, PortalSummary } from "../../types";

const STATUS_ORDER = ["approved", "acknowledged", "in_transit", "received", "cancelled"] as const;

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  acknowledged: "Acknowledged",
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

const ASN_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  received: "Received",
  cancelled: "Cancelled",
};

export default function PortalOverview() {
  const formatDate = useDateFormat();
  const navigate = useNavigate();
  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });
  const { data: summary, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "summary"],
    queryFn: async () => (await api.get("/portal/summary")).data as PortalSummary,
  });
  const currencySymbol = me?.currency_symbol || "$";

  if (isLoading) return <Skeleton variant="card" rows={4} />;
  if (isError || !summary) {
    return (
      <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
        {errorMessage(error, "Failed to load portal summary")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2.5">
            {me?.supplier.image_url && (
              <img src={entityImageUrl(me.supplier.image_url)} alt={me.supplier.name} onError={onImageError} className="h-8 w-8 rounded-lg object-cover shrink-0" />
            )}
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-ink">Welcome, {me?.supplier.name ?? "supplier"}</h1>
              <p className="text-sm text-muted mt-1">Review and acknowledge your purchase orders below.</p>
            </div>
          </div>
      </div>

      <KpiGrid columns={3}>
        <StatCard icon={ClipboardList} tone="primary" label="Total orders" value={summary.total_orders} />
        <StatCard icon={PackageOpen} tone="amber" label="Open orders" value={summary.open_orders} />
        <StatCard icon={CircleDollarSign} tone="emerald" label="Open value" value={formatCurrency(summary.open_value, currencySymbol)} />
      </KpiGrid>

      <KpiGrid columns={3}>
        <StatCard icon={PackageCheck} tone="sky" label="Shipments" value={summary.total_asns} />
        <StatCard icon={Truck} tone="amber" label="Open shipments" value={summary.asn_counts.pending ?? 0} />
        <StatCard icon={Package} tone="violet" label="Deliveries" value={summary.receipt_count} />
      </KpiGrid>

      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((st) => (
          <span key={st} className={`badge ${statusBadge(st)} inline-flex items-center gap-1.5`}>
            {STATUS_LABEL[st]}
            <span className="opacity-70">{summary.status_counts[st] ?? 0}</span>
          </span>
        ))}
        <span className="badge badge-info inline-flex items-center gap-1.5">
          Total <span className="opacity-70">{summary.total_orders}</span>
        </span>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-ink flex items-center gap-2"><Truck size={16} /> Recent orders</h2>
        </div>
        {summary.recent_orders.length === 0 ? (
          <EmptyState compact icon={<ClipboardList size={20} />} title="No orders yet" message="Approved purchase orders for your company will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Expected</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.recent_orders.map((o) => (
                  <tr key={o.id} className="hover:bg-app cursor-pointer" onClick={() => navigate(`/portal/orders/${o.id}`)}>
                    <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{o.order_number}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(o.created_at)}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{o.expected_arrival ? formatDate(o.expected_arrival) : "—"}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusBadge(o.status)}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(o.total_amount, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-ink flex items-center gap-2"><PackageCheck size={16} /> Recent shipments</h2>
        </div>
        {summary.recent_asns.length === 0 ? (
          <EmptyState compact icon={<PackageCheck size={20} />} title="No shipments yet" message="Shipments raised against your purchase orders will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">ASN</th>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Expected</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.recent_asns.map((a) => (
                  <tr key={a.id} className="hover:bg-app cursor-pointer" onClick={() => navigate(`/portal/asns/${a.id}`)}>
                    <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{a.asn_number}</td>
                    <td className="px-4 py-3 text-muted">{a.order_number ?? "—"}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap hidden sm:table-cell">{a.expected_arrival ? formatDate(a.expected_arrival) : "—"}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusBadge(a.status)}`}>{ASN_STATUS_LABEL[a.status] ?? a.status}</span></td>
                    <td className="px-4 py-3 text-right font-medium">{a.total_expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}