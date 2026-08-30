import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import api from "../../api/client";
import type { OrderSummary } from "../../types";
import { formatCurrency } from "../../utils/currency";
import ReportSkeleton from "../../components/ReportSkeleton";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function OrdersTab({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery<OrderSummary>({
    queryKey: ["reports", "orders"],
    queryFn: async () => (await api.get("/reports/order-summary")).data,
  });

  if (isLoading) return <ReportSkeleton stats={2} twoCharts />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card"><p className="text-sm text-muted">Total Orders</p><p className="text-2xl font-bold mt-1">{data.total_orders}</p></div>
        <div className="card"><p className="text-sm text-muted">Total Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_order_value, symbol, 0)}</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Orders by Status</h3>
          {data.by_status.length === 0 ? (
            <p className="text-muted text-sm">No orders</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={data.by_status} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} label={({ name, value }: any) => `${name}: ${value}`}>
                  {data.by_status.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Top Suppliers by Value</h3>
          {data.top_suppliers.length === 0 ? (
            <p className="text-muted text-sm">No suppliers</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.top_suppliers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="supplier" tick={{ fontSize: 11 }} width={90} />
                <Tooltip formatter={(v: any) => formatCurrency(Number(v), symbol, 0)} />
                <Bar dataKey="total_value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
