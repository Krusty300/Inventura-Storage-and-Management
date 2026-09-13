import { useState } from "react";
import { PackageSearch } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { StockoutRisk } from "../../types";
import ReportSkeleton from "../../components/ReportSkeleton";
import FittedSelect from "../../components/FittedSelect";
import EmptyState from "../../components/EmptyState";

export default function StockoutTab() {
  const [leadTime, setLeadTime] = useState(7);
  const { data, isLoading, isError } = useQuery<StockoutRisk>({
    queryKey: ["reports", "stockout", leadTime],
    queryFn: async () => (await api.get("/reports/stockout-risk", { params: { lead_time_days: leadTime } })).data,
  });

  if (isLoading) return <ReportSkeleton stats={3} table tableCols={7} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const badge = (level: string) =>
    level === "high" ? "badge-danger" : level === "medium" ? "badge-warning" : "badge-success";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card"><p className="text-sm text-muted">High Risk</p><p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{data.summary.high}</p></div>
          <div className="card"><p className="text-sm text-muted">Medium Risk</p><p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{data.summary.medium}</p></div>
          <div className="card"><p className="text-sm text-muted">Low Risk</p><p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">{data.summary.low}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor="lead-time">Lead time (days)</label>
          <FittedSelect
            value={String(leadTime)}
            onChange={(v) => setLeadTime(Number(v))}
            ariaLabel="Lead time"
            maxWidth={110}
            options={[3, 5, 7, 10, 14, 21, 30].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">SKU</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">On Hand</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Avg Daily Demand</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Days of Supply</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Suggested Reorder</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6"><EmptyState variant="table" icon={<PackageSearch size={48} />} title="No products" message="Products at stockout risk will appear here." /></td></tr>
              ) : data.items.map((p) => (
                <tr key={p.product_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">{p.product_name}</td>
                  <td className="px-4 py-3 text-muted">{p.sku}</td>
                  <td className="px-4 py-3">{p.on_hand}</td>
                  <td className="px-4 py-3 text-muted">{p.avg_daily_demand.toFixed(2)}</td>
                  <td className="px-4 py-3">{p.days_of_supply != null ? p.days_of_supply.toFixed(1) : "—"}</td>
                  <td className="px-4 py-3">{p.suggested_reorder}</td>
                  <td className="px-4 py-3"><span className={`badge ${badge(p.risk_level)}`}>{p.risk_level}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
