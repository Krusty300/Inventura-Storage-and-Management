import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import type { ManufacturingCostReport } from "../../types";
import { formatCurrency } from "../../utils/currency";
import { useDateFormat } from "../../hooks/useDateFormat";
import ReportSkeleton from "../../components/ReportSkeleton";
import EmptyState from "../../components/EmptyState";
import { Factory } from "lucide-react";

export default function ManufacturingCostTab({ symbol }: { symbol: string }) {
  const formatDate = useDateFormat();
  const { data, isLoading, isError } = useQuery<ManufacturingCostReport>({
    queryKey: ["costing", "report"],
    queryFn: async () => (await api.get("/costing/report")).data,
  });

  if (isLoading) return <ReportSkeleton stats={4} table tableCols={8} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card"><p className="text-sm text-muted">Completed Orders</p><p className="text-2xl font-bold mt-1">{data.completed_orders}</p></div>
        <div className="card"><p className="text-sm text-muted">Total Material Cost</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_material_cost, symbol, 0)}</p></div>
        <div className="card"><p className="text-sm text-muted">Standard Cost</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_standard_cost, symbol, 0)}</p></div>
        <div className="card">
          <p className="text-sm text-muted">Cost Variance</p>
          <p className={`text-2xl font-bold mt-1 ${data.total_variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{data.total_variance >= 0 ? "+" : ""}{formatCurrency(data.total_variance, symbol, 0)}</p>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">WO #</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Qty</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Completed</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Material Cost</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Std / Unit</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Actual / Unit</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <EmptyState variant="table" icon={<Factory size={40} />} title="No completed work orders" message="Manufacturing cost analysis will appear here once work orders are completed." />
              ) : data.items.map((row) => (
                <tr key={row.wo_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">{row.wo_number}</td>
                  <td className="px-4 py-3 text-muted">{row.product_name}</td>
                  <td className="px-4 py-3">{row.quantity}</td>
                  <td className="px-4 py-3 text-muted">{row.completed_at ? formatDate(row.completed_at) : "—"}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.material_cost, symbol)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.standard_unit_cost, symbol)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.actual_unit_cost, symbol)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${row.variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{row.variance >= 0 ? "+" : ""}{formatCurrency(row.variance, symbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
