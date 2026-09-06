import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import api from "../../api/client";
import type { StockMovementTrends } from "../../types";
import ReportSkeleton from "../../components/ReportSkeleton";

export default function MovementsTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const dateInvalid = !!startDate && !!endDate && startDate > endDate;

  const rangeParams = () => {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return params;
  };

  const { data, isLoading, isError } = useQuery<StockMovementTrends>({
    queryKey: ["reports", "movements", startDate, endDate],
    queryFn: async () => (await api.get("/reports/stock-movement-trends", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  if (isLoading) return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input type="date" className="input text-sm py-1.5" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
        <span className="text-faint text-sm">to</span>
        <input type="date" className="input text-sm py-1.5" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
      </div>
      <ReportSkeleton stats={3} chart chartHeight={350} />
    </div>
  );
  if (isError || !data) return <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load report data.</div>;

  const hasRange = !!startDate || !!endDate;
  const label = hasRange ? "Selected Range" : "30d";

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card"><p className="text-sm text-muted">Stock In ({label})</p><p className="text-2xl font-bold mt-1">{data.total_in.toLocaleString()}</p></div>
        <div className="card"><p className="text-sm text-muted">Stock Out ({label})</p><p className="text-2xl font-bold mt-1">{data.total_out.toLocaleString()}</p></div>
        <div className="card"><p className="text-sm text-muted">Net Movement</p><p className={`text-2xl font-bold mt-1 ${data.net_movement >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>{data.net_movement >= 0 ? "+" : ""}{data.net_movement.toLocaleString()}</p></div>
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Daily Stock Movement Trends</h3>
        {data.daily_trends.length === 0 ? (
          <p className="text-muted text-sm">No movements in the selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={data.daily_trends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="in" stroke="#10b981" name="In" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="out" stroke="#ef4444" name="Out" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
