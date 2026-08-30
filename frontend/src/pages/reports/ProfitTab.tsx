import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { ProfitAnalysis } from "../../types";
import { formatCurrency } from "../../utils/currency";
import ReportSkeleton from "../../components/ReportSkeleton";

export default function ProfitTab({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery<ProfitAnalysis>({
    queryKey: ["reports", "profit"],
    queryFn: async () => (await api.get("/reports/profit-analysis")).data,
  });

  if (isLoading) return <ReportSkeleton stats={3} table tableCols={7} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card"><p className="text-sm text-muted">Total Cost</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_cost_value, symbol, 0)}</p></div>
        <div className="card"><p className="text-sm text-muted">Potential Revenue</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_potential_revenue, symbol, 0)}</p></div>
        <div className="card"><p className="text-sm text-muted">Potential Profit</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_potential_profit, symbol, 0)}</p></div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">SKU</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Qty</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Unit Cost</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Unit Price</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Margin</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Total Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.products.map((p) => (
                <tr key={p.id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-muted">{p.sku}</td>
                  <td className="px-4 py-3">{p.quantity}</td>
                  <td className="px-4 py-3">{formatCurrency(p.unit_cost, symbol)}</td>
                  <td className="px-4 py-3">{formatCurrency(p.unit_price, symbol)}</td>
                  <td className="px-4 py-3">
                    <span className={p.margin_percentage >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                      {p.margin_percentage >= 0 ? "+" : ""}{p.margin_percentage}%
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-medium ${p.total_profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {formatCurrency(p.total_profit, symbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
