import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import api from "../../api/client";
import type { InventoryValuation } from "../../types";
import { formatCurrency } from "../../utils/currency";
import ReportSkeleton from "../../components/ReportSkeleton";

export default function ValuationTab({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery<InventoryValuation>({
    queryKey: ["reports", "valuation"],
    queryFn: async () => (await api.get("/reports/inventory-valuation")).data,
  });

  if (isLoading) return <ReportSkeleton stats={3} twoCharts />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const cards = [
    { label: "Inventory Value (Cost)", value: formatCurrency(data.total_inventory_value, symbol, 0) },
    { label: "Retail Value", value: formatCurrency(data.total_retail_value, symbol, 0) },
    { label: "Potential Profit", value: formatCurrency(data.potential_profit, symbol, 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <p className="text-sm text-muted">{c.label}</p>
            <p className="text-2xl font-bold mt-1">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Value by Category</h3>
          {data.by_category.length === 0 ? (
            <p className="text-muted text-sm">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.by_category}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => formatCurrency(Number(v), symbol, 0)} />
                <Bar dataKey="total_value" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Value by Supplier</h3>
          {data.by_supplier.length === 0 ? (
            <p className="text-muted text-sm">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.by_supplier}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="supplier" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => formatCurrency(Number(v), symbol, 0)} />
                <Bar dataKey="total_value" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
