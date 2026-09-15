import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, Search, ClipboardList, TrendingUp, Building2 } from "lucide-react";
import api from "../api/client";
import { useDateFormat } from "../hooks/useDateFormat";
import { useDebounce } from "../hooks/useDebounce";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import Table from "../components/Table";
import SlideOver from "../components/SlideOver";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { errorMessage } from "../utils/errors";
import type { SupplierPerformance, SupplierPerformanceDetail } from "../types";

const RATING_BADGE: Record<string, string> = {
  excellent: "badge-success",
  good: "badge-info",
  fair: "badge-warning",
  poor: "badge-danger",
};

const RATING_LABEL: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

function scoreColor(score: number | null): string {
  if (score === null) return "bg-faint";
  if (score >= 85) return "bg-emerald-500";
  if (score >= 70) return "bg-primary";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-app rounded-lg p-4 min-w-0">
      <p className="text-muted text-xs">{label}</p>
      <p className="font-semibold text-xl mt-1 truncate">{value}</p>
    </div>
  );
}

function DimensionCard({ title, metric, sub }: { title: string; metric: string; sub: string }) {
  return (
    <div className="bg-app rounded-lg p-4 min-w-0">
      <p className="text-muted text-xs">{title}</p>
      <p className="font-semibold text-xl mt-1 text-ink">{metric}</p>
      <p className="text-xs text-faint mt-0.5">{sub}</p>
    </div>
  );
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-faint text-xs">No data</span>;
  return <span className={`badge ${RATING_BADGE[rating] ?? "badge-info"}`}>{RATING_LABEL[rating] ?? rating}</span>;
}

function SupplierPerformanceDetailPanel({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supplier-performance", supplierId],
    queryFn: async () => (await api.get(`/suppliers/${supplierId}/performance`)).data as SupplierPerformanceDetail,
  });

  return (
    <SlideOver open onClose={onClose} title={data?.name ?? "Supplier performance"} wide ariaLabel="Supplier performance detail">
      {isLoading ? (
        <Skeleton variant="rows" rows={6} cols={4} />
      ) : isError ? (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load performance")}
        </div>
      ) : data ? (
        <div className="space-y-5 text-sm">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs flex items-center gap-1"><Award size={13} />Score</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="font-bold text-xl text-ink">{data.score ?? "—"}</span>
                <RatingBadge rating={data.rating} />
              </div>
              <div className="h-1.5 w-full rounded-full bg-subtle overflow-hidden mt-2">
                <div className={`h-full rounded-full ${scoreColor(data.score)}`} style={{ width: `${data.score ?? 0}%` }} aria-hidden />
              </div>
            </div>
            <MetricCard label="Orders" value={String(data.volume.total_orders)} />
            <MetricCard label="Total Spent" value={formatCurrency(data.volume.total_spent, currencySymbol)} />
            <MetricCard label="Open Orders" value={String(data.volume.open_orders)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DimensionCard
              title="On-time delivery"
              metric={pct(data.on_time.rate)}
              sub={data.on_time.orders > 0 ? `${data.on_time.on_time} of ${data.on_time.orders} on time` : "No expected arrivals yet"}
            />
            <DimensionCard
              title="Quality pass rate"
              metric={pct(data.quality.pass_rate)}
              sub={data.quality.checks > 0 ? `${data.quality.passed} of ${data.quality.checks} checks passed` : "No quality checks yet"}
            />
            <DimensionCard
              title="Lead-time adherence"
              metric={pct(data.lead_time.adherence)}
              sub={
                data.lead_time.promised_days
                  ? `${data.lead_time.actual_avg_days ?? "—"}/${data.lead_time.promised_days} days avg`
                  : "No promised lead time set"
              }
            />
          </div>

          {data.price_trend.length > 0 && (
            <div>
              <h3 className="font-semibold text-ink mb-2 flex items-center gap-1.5"><TrendingUp size={15} />Unit Price Trend</h3>
              <div className="border border-border rounded-lg divide-y divide-border">
                {data.price_trend.map((p) => (
                  <div key={p.month} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted">{p.month}</span>
                    <span className="font-medium text-ink">{formatCurrency(p.avg_unit_price, currencySymbol)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-ink mb-2">Recent Received Orders</h3>
            {data.recent_orders.length === 0 ? (
              <EmptyState compact icon={<ClipboardList size={20} />} title="No received orders" message="Once orders are received, their on-time performance shows here." />
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-sm min-w-max">
                  <thead>
                    <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                      <th className="px-3 py-2.5 font-medium">Order #</th>
                      <th className="px-3 py-2.5 font-medium">Received</th>
                      <th className="px-3 py-2.5 font-medium">Expected</th>
                      <th className="px-3 py-2.5 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.recent_orders.map((o) => (
                      <tr key={o.order_id}>
                        <td className="px-3 py-2.5 font-medium text-ink whitespace-nowrap">{o.order_number}</td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap">{o.received_at ? formatDate(o.received_at) : "—"}</td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap">{o.expected_arrival ? formatDate(o.expected_arrival) : "—"}</td>
                        <td className="px-3 py-2.5">
                          {o.on_time === null ? (
                            <span className="text-faint">—</span>
                          ) : o.on_time ? (
                            <span className="badge badge-success">On time</span>
                          ) : (
                            <span className="badge badge-danger">Late</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </SlideOver>
  );
}

export default function SupplierPerformancePage() {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [viewing, setViewing] = useState<SupplierPerformance | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supplier-performance-list", debouncedSearch, sortBy, order],
    queryFn: async () => {
      const params: Record<string, string> = { sort_by: sortBy, order };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/suppliers/performance", { params });
      return data as { items: SupplierPerformance[]; total: number };
    },
  });

  const rows = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Award size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Supplier Performance</h1>
            <p className="text-sm text-muted mt-1">On-time delivery, quality, and lead-time reliability across your suppliers.</p>
          </div>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load performance")}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-center">
        <div className="relative sm:col-span-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search suppliers" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="whitespace-nowrap">Sort by</span>
          <select
            className="input"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort by"
          >
            <option value="score">Score</option>
            <option value="name">Name</option>
            <option value="on_time">On-time</option>
            <option value="total_spent">Total spent</option>
            <option value="total_orders">Orders</option>
          </select>
        </label>
        <button
          type="button"
          className="btn-secondary justify-center"
          onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
          aria-label="Toggle sort direction"
        >
          {order === "desc" ? "High to low" : "Low to high"}
        </button>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table
            columns={[
              { key: 'supplier', header: 'Supplier', className: 'px-4 py-3 font-medium text-muted' },
              { key: 'score', header: 'Score', className: 'px-4 py-3 font-medium text-muted' },
              { key: 'onTime', header: 'On-time', className: 'px-4 py-3 font-medium text-muted text-right hidden md:table-cell' },
              { key: 'quality', header: 'Quality', className: 'px-4 py-3 font-medium text-muted text-right hidden lg:table-cell' },
              { key: 'leadTime', header: 'Lead time', className: 'px-4 py-3 font-medium text-muted text-right hidden lg:table-cell' },
              { key: 'orders', header: 'Orders', className: 'px-4 py-3 font-medium text-muted text-right' },
              { key: 'open', header: 'Open', className: 'px-4 py-3 font-medium text-muted text-right hidden md:table-cell' },
              { key: 'spent', header: 'Total Spent', className: 'px-4 py-3 font-medium text-muted text-right' },
              { key: 'lastOrder', header: 'Last Order', className: 'px-4 py-3 font-medium text-muted text-right hidden sm:table-cell' },
            ]}
            aria-label="Supplier performance table"
            loading={isLoading}
            skeletonRows={5}
            noData={rows.length === 0}
            empty={
              <EmptyState
                title={search ? "No matching suppliers" : "No suppliers"}
                message={search ? `Nothing matched "${search}". Try adjusting your search.` : "Add suppliers and received orders to start tracking performance."}
              />
            }
          >
            {rows.map((s) => (
              <tr key={s.supplier_id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(s)}>
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-subtle border border-border flex items-center justify-center shrink-0 overflow-hidden">
                      <Building2 size={15} className="text-faint" />
                    </span>
                    <span className="truncate max-w-[180px]">{s.name}</span>
                    {!s.is_active && <span className="badge badge-warning shrink-0">Inactive</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-subtle overflow-hidden">
                      <div className={`h-full rounded-full ${scoreColor(s.score)}`} style={{ width: `${s.score ?? 0}%` }} aria-hidden />
                    </div>
                    <span className="font-semibold text-ink">{s.score ?? "—"}</span>
                    <RatingBadge rating={s.rating} />
                  </div>
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell">
                  <span className={s.on_time_rate === null ? "text-faint" : "text-muted"}>{pct(s.on_time_rate)}</span>
                </td>
                <td className="px-4 py-3 text-right hidden lg:table-cell">
                  <span className={s.quality_pass_rate === null ? "text-faint" : "text-muted"}>{pct(s.quality_pass_rate)}</span>
                </td>
                <td className="px-4 py-3 text-right hidden lg:table-cell">
                  <span className={s.lead_adherence === null ? "text-faint" : "text-muted"}>{pct(s.lead_adherence)}</span>
                </td>
                <td className="px-4 py-3 text-right">{s.total_orders.toLocaleString()}</td>
                <td className="px-4 py-3 text-right hidden md:table-cell">{s.open_orders.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(s.total_spent, currencySymbol)}</td>
                <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap text-muted">
                  {s.last_order_at ? formatDate(s.last_order_at) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      {viewing && <SupplierPerformanceDetailPanel supplierId={viewing.supplier_id} onClose={() => setViewing(null)} />}
    </div>
  );
}