import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { TopSuppliersReport } from "../../types";
import { formatCurrency } from "../../utils/currency";
import { useDateFormat } from "../../hooks/useDateFormat";
import ReportSkeleton from "../../components/ReportSkeleton";

export default function SuppliersTab({ symbol }: { symbol: string }) {
  const formatDate = useDateFormat();
  const [topDays, setTopDays] = useState<number | "all">("all");
  const { data, isLoading, isError } = useQuery<TopSuppliersReport>({
    queryKey: ["reports", "top-suppliers", topDays],
    queryFn: async () => {
      const params: Record<string, string> = { limit: "25" };
      if (topDays !== "all") params.days = String(topDays);
      return (await api.get("/reports/top-suppliers", { params })).data;
    },
  });

  if (isLoading) return <ReportSkeleton stats={3} table tableCols={6} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const maxSpent = Math.max(...data.items.map((s) => s.total_spent), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card"><p className="text-sm text-muted">Top Suppliers</p><p className="text-2xl font-bold mt-1">{data.total}</p></div>
          <div className="card"><p className="text-sm text-muted">Top Supplier</p><p className="text-2xl font-bold mt-1">{data.items[0]?.name || "—"}</p></div>
          <div className="card"><p className="text-sm text-muted">Top Supplier Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.items[0]?.total_spent ?? 0, symbol)}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor="top-sup-days">Period</label>
          <select id="top-sup-days" className="select w-32" value={topDays} onChange={(e) => setTopDays(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">#</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Supplier</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Contact</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Orders</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Total Spent</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Last Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No supplier order data</td></tr>
              ) : data.items.map((s, i) => (
                <tr key={s.supplier_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium text-faint">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-muted">{s.contact_person}</td>
                  <td className="px-4 py-3">{s.total_orders}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-subtle rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxSpent > 0 ? Math.min((s.total_spent / maxSpent) * 100, 100) : 0}%` }} />
                      </div>
                      <span>{formatCurrency(s.total_spent, symbol)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{s.last_order_at ? formatDate(s.last_order_at) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
