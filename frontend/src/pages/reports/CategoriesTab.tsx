import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import api from "../../api/client";
import type { CategoryBreakdownItem } from "../../types";
import { formatCurrency } from "../../utils/currency";
import ReportSkeleton from "../../components/ReportSkeleton";

export default function CategoriesTab({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery<CategoryBreakdownItem[]>({
    queryKey: ["reports", "categories"],
    queryFn: async () => (await api.get("/reports/category-breakdown")).data,
  });

  if (isLoading) return <ReportSkeleton stats={0} chart table tableCols={5} />;
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Products by Category</h3>
        {data.length === 0 ? (
          <p className="text-muted text-sm">No categories</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="product_count" fill="#6366f1" name="Products" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto mt-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Category</th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Products</th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Total Stock</th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Cost Value</th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted">Retail Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-app">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3">{r.product_count}</td>
                      <td className="px-4 py-3">{r.total_stock}</td>
                      <td className="px-4 py-3">{formatCurrency(r.total_cost_value, symbol, 0)}</td>
                      <td className="px-4 py-3">{formatCurrency(r.total_retail_value, symbol, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
