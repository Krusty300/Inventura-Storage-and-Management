import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { InventoryAging } from "../../types";
import { useDateFormat } from "../../hooks/useDateFormat";
import ReportSkeleton from "../../components/ReportSkeleton";

export default function AgingTab() {
  const formatDate = useDateFormat();
  const { data, isLoading, isError } = useQuery<InventoryAging>({
    queryKey: ["reports", "aging"],
    queryFn: async () => (await api.get("/reports/inventory-aging")).data,
  });

  if (isLoading) return <ReportSkeleton stats={4} table tableCols={7} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const maxAge = Math.max(...data.items.map((i) => i.age_days), 0);
  const buckets = [
    { label: "< 30 days", min: 0, max: 29 },
    { label: "30-89 days", min: 30, max: 89 },
    { label: "90-179 days", min: 90, max: 179 },
    { label: "180+ days", min: 180, max: Infinity },
  ].map((b) => {
    const rows = data.items.filter((i) => i.age_days >= b.min && i.age_days <= b.max);
    return { ...b, count: rows.length, quantity: rows.reduce((s, r) => s + r.on_hand, 0) };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {buckets.map((b) => (
          <div key={b.label} className="card">
            <p className="text-sm text-muted">{b.label}</p>
            <p className="text-2xl font-bold mt-1">{b.count}</p>
            <p className="text-xs text-faint">{b.quantity} units</p>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Inventory Age ({data.total} lots with stock)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Lot</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">On Hand</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Age (days)</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Last Movement</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Avg Daily Demand</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Days of Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No lot-level stock</td></tr>
              ) : data.items.map((row) => {
                const pct = maxAge > 0 ? (row.age_days / maxAge) * 100 : 0;
                const color = row.age_days >= 180 ? "bg-red-500" : row.age_days >= 90 ? "bg-amber-500" : row.age_days >= 30 ? "bg-yellow-400" : "bg-green-500";
                return (
                  <tr key={row.lot_id} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{row.lot_number}</td>
                    <td className="px-4 py-3 text-muted">{row.product_name}</td>
                    <td className="px-4 py-3">{row.on_hand}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-subtle rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-xs">{row.age_days}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.last_movement_at ? formatDate(row.last_movement_at) : "Never"}</td>
                    <td className="px-4 py-3 text-muted">{row.avg_daily_demand.toFixed(2)}</td>
                    <td className="px-4 py-3">{row.days_of_stock != null ? row.days_of_stock.toFixed(1) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
