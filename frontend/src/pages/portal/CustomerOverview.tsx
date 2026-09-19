import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Receipt, CircleDollarSign, ShoppingBag, Package } from "lucide-react";
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
import type { CustomerPortalMe, CustomerPortalSummary } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default function CustomerOverview() {
  const formatDate = useDateFormat();
  const navigate = useNavigate();
  const { data: me } = useQuery({
    queryKey: ["customer", "me"],
    queryFn: async () => (await api.get("/customer/me")).data as CustomerPortalMe,
  });
  const { data: summary, isLoading, isError, error } = useQuery({
    queryKey: ["customer", "summary"],
    queryFn: async () => (await api.get("/customer/summary")).data as CustomerPortalSummary,
  });
  const currencySymbol = me?.currency_symbol || "$";

  if (isLoading) return <Skeleton variant="card" rows={4} />;
  if (isError || !summary) {
    return (
      <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
        {errorMessage(error, "Failed to load account summary")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {me?.customer.image_url && (
            <img src={entityImageUrl(me.customer.image_url)} alt={me.customer.name} onError={onImageError} className="h-8 w-8 rounded-lg object-cover shrink-0" />
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Welcome, {me?.customer.name ?? "customer"}</h1>
            <p className="text-sm text-muted mt-1">Browse the catalog and review your invoices below.</p>
          </div>
        </div>
      </div>

      <KpiGrid columns={3}>
        <StatCard icon={Receipt} tone="primary" label="Total invoices" value={summary.total_sales} />
        <StatCard icon={CircleDollarSign} tone="emerald" label="Total spent" value={formatCurrency(summary.total_spent, currencySymbol)} />
        <StatCard icon={ShoppingBag} tone="amber" label="In progress" value={summary.status_counts.pending ?? 0} />
      </KpiGrid>

      <div className="flex flex-wrap gap-2">
        {(["pending", "completed", "cancelled", "refunded"] as const).map((st) => (
          <span key={st} className={`badge ${statusBadge(st)} inline-flex items-center gap-1.5`}>
            {STATUS_LABEL[st]}
            <span className="opacity-70">{summary.status_counts[st] ?? 0}</span>
          </span>
        ))}
        <span className="badge badge-info inline-flex items-center gap-1.5">
          Total <span className="opacity-70">{summary.total_sales}</span>
        </span>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-ink flex items-center gap-2"><Receipt size={16} /> Recent invoices</h2>
          <button onClick={() => navigate("/portal/invoices")} className="text-sm font-medium text-primary-strong dark:text-primary hover:underline">
            View all
          </button>
        </div>
        {summary.recent_sales.length === 0 ? (
          <EmptyState compact icon={<Package size={20} />} title="No invoices yet" message="Invoices for your purchases will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.recent_sales.map((s) => (
                  <tr key={s.id} className="hover:bg-app cursor-pointer" onClick={() => navigate(`/portal/invoices/${s.id}`)}>
                    <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{s.invoice_number}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(s.created_at)}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusBadge(s.status)}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(s.total_amount, currencySymbol)}</td>
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