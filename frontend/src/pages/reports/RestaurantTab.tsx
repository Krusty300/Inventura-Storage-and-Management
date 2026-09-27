import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import api from "../../api/client";
import type { RestaurantSummary, RestaurantDailyTrends, RestaurantTurnTimes } from "../../types";
import { formatCurrency } from "../../utils/currency";
import { paymentLabel } from "../../utils/payments";
import ReportSkeleton from "../../components/ReportSkeleton";
import DatePicker from "../../components/DatePicker";
import EmptyState from "../../components/EmptyState";
import { Users, Receipt, Banknote, Utensils, Wallet, Timer } from "lucide-react";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function RestaurantTab({ symbol }: { symbol: string }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [trendDays, setTrendDays] = useState(30);
  const dateInvalid = !!startDate && !!endDate && startDate > endDate;

  const rangeParams = () => {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return params;
  };

  const { data, isLoading, isError } = useQuery<RestaurantSummary>({
    queryKey: ["reports", "restaurant-summary", startDate, endDate],
    queryFn: async () => (await api.get("/reports/restaurant-summary", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  const { data: trends } = useQuery<RestaurantDailyTrends>({
    queryKey: ["reports", "restaurant-trends", trendDays],
    queryFn: async () => (await api.get("/reports/restaurant-daily-trends", { params: { days: String(trendDays) } })).data,
  });

  const { data: turnTimes } = useQuery<RestaurantTurnTimes>({
    queryKey: ["reports", "restaurant-turn-times", startDate, endDate],
    queryFn: async () => (await api.get("/reports/restaurant-turn-times", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  if (isLoading) return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DatePicker value={startDate} onChange={setStartDate} ariaLabel="Start date" inputClassName="text-sm py-1.5" />
        <span className="text-faint text-sm">to</span>
        <DatePicker value={endDate} onChange={setEndDate} ariaLabel="End date" inputClassName="text-sm py-1.5" />
      </div>
      <ReportSkeleton stats={4} chart table tableCols={3} />
    </div>
  );
  if (dateInvalid) return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DatePicker value={startDate} onChange={setStartDate} ariaLabel="Start date" inputClassName="text-sm py-1.5" />
        <span className="text-faint text-sm">to</span>
        <DatePicker value={endDate} onChange={setEndDate} ariaLabel="End date" inputClassName="text-sm py-1.5" />
        <button onClick={() => { setStartDate(""); setEndDate(""); }} className="text-sm text-primary dark:text-primary hover:text-primary-strong underline" aria-label="Clear date range">Clear</button>
      </div>
      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg text-sm" role="alert">Start date must be before end date.</div>
    </div>
  );
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load restaurant report data.</div>;

  const cards = [
    { icon: <Receipt size={18} />, label: "Settled Tickets", value: data.ticket_count.toString() },
    { icon: <Banknote size={18} />, label: "Revenue", value: formatCurrency(data.total_revenue, symbol, 2) },
    { icon: <Wallet size={18} />, label: "Tips", value: formatCurrency(data.total_tips, symbol, 2) },
    { icon: <Utensils size={18} />, label: "Avg Ticket", value: formatCurrency(data.average_ticket, symbol, 2) },
    { icon: <Users size={18} />, label: "Covers", value: data.total_covers.toString() },
    { icon: <Timer size={18} />, label: "Reservations", value: `${data.reservations_completed}/${data.reservations_total}` },
  ];

  const trendData = (trends?.daily || []).map((d) => ({ ...d, label: d.date.slice(5) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DatePicker value={startDate} onChange={setStartDate} ariaLabel="Start date" inputClassName="text-sm py-1.5" />
        <span className="text-faint text-sm">to</span>
        <DatePicker value={endDate} onChange={setEndDate} ariaLabel="End date" inputClassName="text-sm py-1.5" />
        {(startDate || endDate) && (
          <button onClick={() => { setStartDate(""); setEndDate(""); }} className="text-sm text-primary dark:text-primary hover:text-primary-strong underline" aria-label="Clear date range">Clear</button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="flex items-center gap-2 text-muted text-xs">{c.icon}{c.label}</div>
            <p className="text-xl font-bold mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-semibold">Revenue Trend</h3>
          <select value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))} className="input text-sm py-1 w-auto" aria-label="Trend window">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 365 days</option>
          </select>
        </div>
        {trendData.length === 0 ? (
          <EmptyState variant="block" icon={<Banknote size={48} />} title="No settled tickets in window" message="Revenue will appear here once tickets are settled." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,130,150,0.2)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="tips" name="Tips" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Turn Times</h3>
        {!turnTimes || turnTimes.items_measured === 0 ? (
          <EmptyState
            variant="block"
            icon={<Timer size={48} />}
            title="No measured turn times"
            message="Timing appears once kitchen items are sent, readied and served on settled tickets in this period."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted">Avg prep (send → ready)</div>
                <p className="text-lg font-bold">{turnTimes.avg_prep_minutes}m</p>
              </div>
              <div>
                <div className="text-xs text-muted">Avg turn (send → served)</div>
                <p className="text-lg font-bold">{turnTimes.avg_turn_minutes}m</p>
              </div>
              <div>
                <div className="text-xs text-muted">Slowest 10%</div>
                <p className="text-lg font-bold">{turnTimes.p90_turn_minutes}m</p>
              </div>
              <div>
                <div className="text-xs text-muted">Avg table dwell</div>
                <p className="text-lg font-bold">{turnTimes.avg_ticket_dwell_minutes}m</p>
              </div>
            </div>
            {turnTimes.covers_by_hour.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={turnTimes.covers_by_hour.map((h) => ({ ...h, label: `${h.hour}:00` }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,130,150,0.2)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="covers" name="Covers" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tickets" name="Tickets" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th scope="col" className="px-4 py-2 font-medium text-muted">Ticket</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted">Table</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted">Item</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Minutes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {turnTimes.slowest_items.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-4 text-muted text-center">No served items in this period.</td></tr>
                  ) : turnTimes.slowest_items.map((s, idx) => (
                    <tr key={`${s.ticket_number}-${s.item}-${idx}`}>
                      <td className="px-4 py-2 font-medium">{s.ticket_number}</td>
                      <td className="px-4 py-2">{s.table_number}</td>
                      <td className="px-4 py-2">{s.item}</td>
                      <td className="px-4 py-2 text-right">{s.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Revenue by Payment Method</h3>
          {data.by_payment_method.length === 0 ? (
            <EmptyState variant="block" icon={<Wallet size={48} />} title="No payments recorded" message="Payment breakdowns appear once tickets are settled in this period." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.by_payment_method.map((x) => ({ ...x, label: paymentLabel(x.method) }))} dataKey="total" nameKey="label" cx="50%" cy="50%" outerRadius={85} label={({ name, value }: any) => `${name}: ${formatCurrency(value, symbol)}`}>
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
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tips</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.by_payment_method.map((m) => (
                  <tr key={m.method}>
                    <td className="px-4 py-2">{paymentLabel(m.method)}</td>
                    <td className="px-4 py-2 text-right">{m.count}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(m.total, symbol, 2)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(m.tips, symbol, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Revenue by Server</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-2 font-medium text-muted">Server</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tickets</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Revenue</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tips</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Covers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.by_waiter.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-muted text-center">No server activity in this period.</td></tr>
                ) : data.by_waiter.map((w) => (
                  <tr key={w.waiter}>
                    <td className="px-4 py-2 font-medium">{w.waiter}</td>
                    <td className="px-4 py-2 text-right">{w.count}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(w.total, symbol, 2)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(w.tips, symbol, 2)}</td>
                    <td className="px-4 py-2 text-right">{w.covers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-lg font-semibold my-4">Top Tables</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-2 font-medium text-muted">Table</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tickets</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Revenue</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Covers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.top_tables.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-4 text-muted text-center">No table activity in this period.</td></tr>
                ) : data.top_tables.map((t) => (
                  <tr key={t.table}>
                    <td className="px-4 py-2 font-medium">{t.table}</td>
                    <td className="px-4 py-2 text-right">{t.count}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(t.total, symbol, 2)}</td>
                    <td className="px-4 py-2 text-right">{t.covers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Peak Hours (settled tickets)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-2 font-medium text-muted">Hour</th>
                <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tickets</th>
                <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.by_hour_of_day.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-4 text-muted text-center">No hour data in this period.</td></tr>
              ) : data.by_hour_of_day.map((h) => (
                <tr key={h.hour}>
                  <td className="px-4 py-2 font-medium">{h.hour === 0 ? "12am" : h.hour < 12 ? `${h.hour}am` : h.hour === 12 ? "12pm" : `${h.hour - 12}pm`}</td>
                  <td className="px-4 py-2 text-right">{h.count}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(h.total, symbol, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Top Items Sold</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-2 font-medium text-muted">Item</th>
                <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Qty Sold</th>
                <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.top_items.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-4 text-muted text-center">No items settled in this period.</td></tr>
              ) : data.top_items.map((item) => (
                <tr key={item.product_id}>
                  <td className="px-4 py-2 font-medium">{item.name}</td>
                  <td className="px-4 py-2 text-right">{item.quantity_sold}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(item.revenue, symbol, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}