import { useState } from "react";
import { statusBadge } from "../utils/statusBadges";
import { Eye, TrendingUp } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../api/client";
import type { ForecastingDetail, ForecastingReplenishment } from "../types";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import FittedSelect from "../components/FittedSelect";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";

const SERVICE_LEVELS = [
  { value: "0.9", label: "90%" },
  { value: "0.95", label: "95%" },
  { value: "0.975", label: "97.5%" },
  { value: "0.99", label: "99%" },
];

const HISTORY_DAYS = ["30", "60", "90", "180"];

export default function Forecasting() {
  const [serviceLevel, setServiceLevel] = useState("0.95");
  const [days, setDays] = useState("90");
  const [leadTime, setLeadTime] = useState("");
  const [viewing, setViewing] = useState<ForecastingDetail | null>(null);
  const [confirmReorder, setConfirmReorder] = useState(false);
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const params = {
    service_level: Number(serviceLevel),
    days: Number(days),
    ...(leadTime !== "" ? { lead_time_days: Number(leadTime) } : {}),
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["forecasting", params],
    queryFn: async () => {
      const { data } = await api.get("/forecasting/replenishment", { params });
      return data as ForecastingReplenishment;
    },
  });

  const reorderMutation = useMutation({
    mutationFn: () => api.post("/orders/auto-reorder", null, { params }),
    onSuccess: (res) => {
      const orders = res.data as { order_number: string; items: unknown[] }[];
      const totalProducts = orders.reduce((n, o) => n + o.items.length, 0);
      const numbers = orders.map((o) => `#${o.order_number}`).join(", ");
      addToast(`Reorder PO ${numbers} created for ${totalProducts} product(s)`, "success");
      queryClient.invalidateQueries({ queryKey: ["forecasting"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Auto-reorder failed"), "error");
    },
  });

  const openDetail = async (productId: number) => {
    try {
      const { data } = await api.get(`/forecasting/products/${productId}`, { params });
      setViewing(data as ForecastingDetail);
    } catch {
      addToast("Failed to load forecast detail", "error");
    }
  };

  const ltSource = (s: string) => (s === "supplier" ? "supplier" : s === "history" ? "orders" : s === "override" ? "override" : "default");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <TrendingUp size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Forecasting &amp; Replenishment</h1>
            <p className="text-sm text-muted">Weighted moving-average demand forecasts with safety stock and reorder suggestions.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-secondary inline-flex items-center gap-2" aria-label="Refresh forecasts">
            Refresh
          </button>
          <button onClick={() => setConfirmReorder(true)} className="btn-primary inline-flex items-center gap-2" aria-label="Auto-reorder based on forecast">
            Reorder
          </button>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); refetch(); }}
        className="card p-4 flex flex-wrap items-end gap-4"
      >
        <div className="w-36">
          <label className="block text-sm font-medium text-ink mb-1">Service Level</label>
          <FittedSelect ariaLabel="Service level" value={serviceLevel} onChange={setServiceLevel} options={SERVICE_LEVELS.map((s) => ({ value: s.value, label: s.label }))} />
        </div>
        <div className="w-36">
          <label className="block text-sm font-medium text-ink mb-1">History (days)</label>
          <FittedSelect ariaLabel="History days" value={days} onChange={setDays} options={HISTORY_DAYS.map((d) => ({ value: d, label: d }))} />
        </div>
        <div className="w-40">
          <label className="block text-sm font-medium text-ink mb-1">Lead Time (days)</label>
          <input
            type="number"
            min={1}
            className="input"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            placeholder="Auto"
          />
        </div>
        <button type="submit" className="btn-primary inline-flex items-center gap-2">
          Run Forecast
        </button>
      </form>

      {isLoading && <Skeleton variant="rows" rows={8} cols={7} />}
      {isError && (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load forecasting data</div>
          <button onClick={() => refetch()} className="btn-primary text-sm">Retry</button>
        </div>
      )}
      {!isLoading && !isError && data && data.items.length === 0 && (
        <EmptyState
          variant="block"
          title="No products to analyze"
          message="Forecasting runs against active products. Create products and record sales to see demand forecasts."
        />
      )}
      {!isLoading && !isError && data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Products", value: String(data.summary.products) },
              { label: "Need Reorder", value: String(data.summary.to_reorder), accent: data.summary.to_reorder > 0 },
              { label: "Suggested Qty", value: String(data.summary.total_suggested_qty) },
              { label: "Avg Lead Time", value: `${data.summary.avg_lead_time}d` },
            ].map((card) => (
              <div key={card.label} className="card">
                <p className="text-sm text-muted">{card.label}</p>
                <p className={`text-2xl font-bold mt-1 ${card.accent ? "text-red-600 dark:text-red-400" : "text-ink"}`}>{card.value}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b bg-app">
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium text-right">On Hand</th>
                    <th className="px-4 py-3 font-medium text-right">Forecast/day</th>
                    <th className="px-4 py-3 font-medium text-right">Safety</th>
                    <th className="px-4 py-3 font-medium text-right">Reorder Pt</th>
                    <th className="px-4 py-3 font-medium text-right">Open</th>
                    <th className="px-4 py-3 font-medium text-right">Suggested</th>
                    <th className="px-4 py-3 font-medium text-right">Coverage</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((row) => (
                    <tr key={row.product_id} className="hover:bg-app">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.product_name}</div>
                        <div className="text-xs text-faint">
                          {row.sku}
                          {row.supplier ? ` · ${row.supplier} (${row.lead_time_days}d ${ltSource(row.lead_time_source)})` : ` · ${row.lead_time_days}d ${ltSource(row.lead_time_source)}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{row.on_hand}</td>
                      <td className="px-4 py-3 text-right">{row.forecast}</td>
                      <td className="px-4 py-3 text-right">{row.safety_stock}</td>
                      <td className="px-4 py-3 text-right">{row.reorder_point}</td>
                      <td className="px-4 py-3 text-right">{row.open_orders}</td>
                      <td className={`px-4 py-3 text-right font-medium ${row.suggested_order_qty > 0 ? "text-red-600 dark:text-red-400" : "text-faint"}`}>
                        {row.suggested_order_qty}
                      </td>
                      <td className="px-4 py-3 text-right">{row.days_of_cover ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusBadge(row.status)} capitalize`}>{row.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openDetail(row.product_id)}
                          className="p-1 text-faint hover:text-primary dark:text-primary"
                          aria-label={`View forecast for ${row.product_name}`}
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {viewing && (
        <ForecastDetailModal
          detail={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      <ConfirmDialog
        open={confirmReorder}
        title="Auto-Reorder Stock"
        message={`Generate a purchase order for all ${data?.summary.to_reorder ?? 0} product(s) the forecast says need replenishing?`}
        confirmLabel="Generate PO"
        confirmClass="btn-primary"
        onConfirm={() => { setConfirmReorder(false); reorderMutation.mutate(); }}
        onCancel={() => setConfirmReorder(false)}
      />
    </div>
  );
}

function ForecastDetailModal({
  detail,
  onClose,
}: {
  detail: ForecastingDetail;
  onClose: () => void;
}) {
  const chartData = [
    ...detail.daily.map((d) => ({ date: d.date, actual: d.quantity, forecast: null as number | null })),
    ...detail.forecast_series.map((f) => ({ date: f.date, actual: null as number | null, forecast: f.forecast })),
  ];

  const metrics = [
    { label: "Forecast / day", value: String(detail.forecast) },
    { label: "On hand", value: String(detail.on_hand) },
    { label: "Open orders", value: String(detail.open_orders) },
    { label: "Safety stock", value: String(detail.safety_stock) },
    { label: "Reorder point", value: String(detail.reorder_point) },
    { label: "Suggested order", value: String(detail.suggested_order_qty), accent: detail.suggested_order_qty > 0 },
  ];

  return (
    <Modal open onClose={onClose} title={`Forecast: ${detail.product_name}`} xwide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted">
          <span>{detail.sku}</span>
          {detail.supplier && <span>Supplier: {detail.supplier}</span>}
          <span>Lead time: {detail.lead_time_days} days ({detail.lead_time_source})</span>
          <span>Service level: {Math.round(detail.service_level * 100)}%</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="card p-3">
              <p className="text-xs text-muted">{m.label}</p>
              <p className={`text-lg font-bold mt-0.5 ${m.accent ? "text-red-600 dark:text-red-400" : "text-ink"}`}>{m.value}</p>
            </div>
          ))}
        </div>

        <div className="card p-4">
          <p className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Daily demand vs forecast</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v?.slice(5) || ""} minTickGap={40} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="actual" name="Actual demand" fill="#6366f1" radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Modal>
  );
}
