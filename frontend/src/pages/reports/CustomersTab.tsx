import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { TopCustomersReport } from "../../types";
import { formatCurrency } from "../../utils/currency";
import { useDateFormat } from "../../hooks/useDateFormat";
import ReportSkeleton from "../../components/ReportSkeleton";
import FittedSelect from "../../components/FittedSelect";
import EmptyState from "../../components/EmptyState";
import { Users } from "lucide-react";

export default function CustomersTab({ symbol }: { symbol: string }) {
  const formatDate = useDateFormat();
  const [topDays, setTopDays] = useState<number | "all">("all");
  const { data, isLoading, isError } = useQuery<TopCustomersReport>({
    queryKey: ["reports", "top-customers", topDays],
    queryFn: async () => {
      const params: Record<string, string> = { limit: "25" };
      if (topDays !== "all") params.days = String(topDays);
      return (await api.get("/reports/top-customers", { params })).data;
    },
  });

  if (isLoading) return <ReportSkeleton stats={3} table tableCols={6} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const maxSpent = Math.max(...data.items.map((c) => c.total_spent), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card"><p className="text-sm text-muted">Top Customers</p><p className="text-2xl font-bold mt-1">{data.total}</p></div>
          <div className="card"><p className="text-sm text-muted">Top Spender</p><p className="text-2xl font-bold mt-1">{data.items[0]?.name || "—"}</p></div>
          <div className="card"><p className="text-sm text-muted">Top Customer Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.items[0]?.total_spent ?? 0, symbol)}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor="top-days">Period</label>
          <FittedSelect
            value={String(topDays)}
            onChange={(v) => setTopDays(v === "all" ? "all" : Number(v))}
            ariaLabel="Period"
            maxWidth={160}
            options={[
              { value: "all", label: "All time" },
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
              { value: "365", label: "Last 365 days" },
            ]}
          />
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">#</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Orders</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Total Spent</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Last Purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <EmptyState variant="table" icon={<Users size={40} />} title="No customer sales data" message="Customer sales will appear here once purchases are recorded in this period." />
              ) : data.items.map((c, i) => (
                <tr key={c.customer_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium text-faint">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-muted">{c.phone}</td>
                  <td className="px-4 py-3">{c.total_sales}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-subtle rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${maxSpent > 0 ? Math.min((c.total_spent / maxSpent) * 100, 100) : 0}%` }} />
                      </div>
                      <span>{formatCurrency(c.total_spent, symbol)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.last_purchase_at ? formatDate(c.last_purchase_at) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
