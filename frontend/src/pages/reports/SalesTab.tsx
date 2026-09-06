import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import api from "../../api/client";
import type { SalesSummary, PaymentReconciliation } from "../../types";
import { formatCurrency } from "../../utils/currency";
import { paymentLabel } from "../../utils/payments";
import ReportSkeleton from "../../components/ReportSkeleton";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function SalesTab({ symbol }: { symbol: string }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const dateInvalid = !!startDate && !!endDate && startDate > endDate;

  const rangeParams = () => {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return params;
  };

  const { data, isLoading, isError } = useQuery<SalesSummary>({
    queryKey: ["reports", "sales", startDate, endDate],
    queryFn: async () => (await api.get("/reports/sales-summary", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  const { data: reconciliation } = useQuery<PaymentReconciliation>({
    queryKey: ["reports", "payment-reconciliation", startDate, endDate],
    queryFn: async () => (await api.get("/reports/payment-reconciliation", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  if (isLoading) return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input type="date" className="input text-sm py-1.5" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
        <span className="text-faint text-sm">to</span>
        <input type="date" className="input text-sm py-1.5" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
      </div>
      <ReportSkeleton stats={4} chart table tableCols={3} />
    </div>
  );
  if (dateInvalid) return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input type="date" className="input text-sm py-1.5" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
        <span className="text-faint text-sm">to</span>
        <input type="date" className="input text-sm py-1.5" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
        <button onClick={() => { setStartDate(""); setEndDate(""); }} className="text-sm text-primary dark:text-primary hover:text-primary-strong underline" aria-label="Clear date range">Clear</button>
      </div>
      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg text-sm" role="alert">Start date must be before end date.</div>
    </div>
  );
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const cards = [
    { label: "Completed Sales", value: data.total_sales.toString() },
    { label: "Total Revenue", value: formatCurrency(data.total_revenue, symbol, 2) },
    { label: "Tax Collected", value: formatCurrency(data.total_tax, symbol, 2) },
    { label: "Refunds", value: data.total_refunds.toString() },
  ];

  const providers = data.by_payment_provider || [];
  const channels = data.by_channel || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input type="date" className="input text-sm py-1.5" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
        <span className="text-faint text-sm">to</span>
        <input type="date" className="input text-sm py-1.5" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
        {(startDate || endDate) && (
          <button onClick={() => { setStartDate(""); setEndDate(""); }} className="text-sm text-primary dark:text-primary hover:text-primary-strong underline" aria-label="Clear date range">Clear</button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <p className="text-sm text-muted">{c.label}</p>
            <p className="text-2xl font-bold mt-1">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Sales by Payment Method</h3>
          {data.by_payment_method.length === 0 ? (
            <p className="text-muted text-sm">No sales in period</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={data.by_payment_method.map((x) => ({ ...x, label: paymentLabel(x.method) }))} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={90} label={({ name, value }: any) => `${name}: ${value}`}>
                  {data.by_payment_method.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-2 font-medium text-muted">Method</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Count</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.by_payment_method.map((m) => (
                  <tr key={m.method}>
                    <td className="px-4 py-2">{paymentLabel(m.method)}</td>
                    <td className="px-4 py-2 text-right">{m.count}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(m.total, symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card overflow-hidden p-0">
          <h3 className="text-lg font-semibold px-4 pt-4 pb-2">Top Selling Products</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Product</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Units Sold</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.top_products.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted">No sales data</td></tr>
                ) : data.top_products.map((p) => (
                  <tr key={p.name} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3">{p.quantity_sold}</td>
                    <td className="px-4 py-3">{formatCurrency(p.revenue, symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {channels.length > 0 && (
        <div className="card overflow-hidden p-0">
          <h3 className="text-lg font-semibold px-4 pt-4 pb-2">Sales by Channel</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Channel</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Count</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {channels.map((ch) => (
                  <tr key={ch.channel} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{ch.channel}</td>
                    <td className="px-4 py-3">{ch.count}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(ch.total, symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {providers.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Mobile Money by Provider</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-2 font-medium text-muted">Provider</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Count</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {providers.map((p) => (
                  <tr key={p.provider}>
                    <td className="px-4 py-2">{paymentLabel("mobile_money", p.provider)}</td>
                    <td className="px-4 py-2 text-right">{p.count}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(p.total, symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reconciliation && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h3 className="text-lg font-semibold">Payment Reconciliation</h3>
            <div className="flex gap-4 text-sm text-muted">
              <span>Gross <span className="font-medium text-ink">{formatCurrency(reconciliation.gross_total, symbol)}</span></span>
              <span>Refunded <span className="font-medium text-ink">{formatCurrency(reconciliation.refunded_total, symbol)}</span></span>
              <span>Net <span className="font-medium text-ink">{formatCurrency(reconciliation.net_total, symbol)}</span></span>
              <span>Pending refunds <span className="font-medium text-ink">{reconciliation.pending_refunds}</span></span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Method</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted">Provider</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Count</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Total</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Refunded</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Pending</th>
                  <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reconciliation.rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No payments in period</td></tr>
                ) : reconciliation.rows.map((r) => (
                  <tr key={`${r.method}-${r.provider || ""}`} className="hover:bg-app">
                    <td className="px-4 py-3">{paymentLabel(r.method)}</td>
                    <td className="px-4 py-3 text-muted">{r.provider ? paymentLabel("mobile_money", r.provider) : "—"}</td>
                    <td className="px-4 py-3 text-right">{r.count}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.gross_total, symbol)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.refunded_total, symbol)}</td>
                    <td className="px-4 py-3 text-right">{r.pending_refunds}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.net_total, symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
