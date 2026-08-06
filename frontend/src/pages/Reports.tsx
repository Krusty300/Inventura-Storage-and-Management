import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../api/client";
import type {
  InventoryValuation, StockMovementTrends, CategoryBreakdownItem,
  ProfitAnalysis, OrderSummary, SalesSummary, InventoryAging, StockoutRisk,
  TopCustomersReport, TopSuppliersReport, ManufacturingCostReport,
} from "../types";
import { useToast } from "../context/ToastContext";
import { formatCurrency } from "../utils/currency";
import { downloadBlob } from "../utils/download";
import { useSettings } from "../hooks/useSettings";
const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

const tabs = [
  { key: "valuation", label: "Valuation" },
  { key: "movements", label: "Movements" },
  { key: "categories", label: "Categories" },
  { key: "profit", label: "Profit" },
  { key: "orders", label: "Orders" },
  { key: "sales", label: "Sales" },
  { key: "aging", label: "Aging" },
  { key: "stockout", label: "Stockout Risk" },
  { key: "customers", label: "Top Customers" },
  { key: "suppliers", label: "Top Suppliers" },
  { key: "manufacturing-cost", label: "Manufacturing Cost" },
] as const;

type Tab = (typeof tabs)[number]["key"];

function TabState({ isLoading, isError }: { isLoading: boolean; isError: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
        Failed to load report data.
      </div>
    );
  }
  return null;
}

export default function Reports() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<Tab>(tabs.some((t) => t.key === tabParam) ? (tabParam as Tab) : "valuation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const dateInvalid = !!startDate && !!endDate && startDate > endDate;

  const rangeParams = () => {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return params;
  };

  const { data: valuation, isLoading: valuationLoading, isError: valuationError } = useQuery<InventoryValuation>({
    queryKey: ["reports", "valuation"],
    queryFn: async () => (await api.get("/reports/inventory-valuation")).data,
  });

  const { data: movements, isLoading: movementsLoading, isError: movementsError } = useQuery<StockMovementTrends>({
    queryKey: ["reports", "movements", startDate, endDate],
    queryFn: async () => (await api.get("/reports/stock-movement-trends", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  const { data: categories, isLoading: categoriesLoading, isError: categoriesError } = useQuery<CategoryBreakdownItem[]>({
    queryKey: ["reports", "categories"],
    queryFn: async () => (await api.get("/reports/category-breakdown")).data,
  });

  const { data: profit, isLoading: profitLoading, isError: profitError } = useQuery<ProfitAnalysis>({
    queryKey: ["reports", "profit"],
    queryFn: async () => (await api.get("/reports/profit-analysis")).data,
  });

  const { data: orderSummary, isLoading: orderSummaryLoading, isError: orderSummaryError } = useQuery<OrderSummary>({
    queryKey: ["reports", "orders"],
    queryFn: async () => (await api.get("/reports/order-summary")).data,
  });

  const { data: salesSummary, isLoading: salesLoading, isError: salesError } = useQuery<SalesSummary>({
    queryKey: ["reports", "sales", startDate, endDate],
    queryFn: async () => (await api.get("/reports/sales-summary", { params: rangeParams() })).data,
    enabled: !dateInvalid,
  });

  const { data: aging, isLoading: agingLoading, isError: agingError } = useQuery<InventoryAging>({
    queryKey: ["reports", "aging"],
    queryFn: async () => (await api.get("/reports/inventory-aging")).data,
  });

  const leadTimeParam = Number(searchParams.get("lead_time_days"));
  const [leadTime, setLeadTime] = useState(leadTimeParam > 0 ? leadTimeParam : 7);
  const { data: stockout, isLoading: stockoutLoading, isError: stockoutError } = useQuery<StockoutRisk>({
    queryKey: ["reports", "stockout", leadTime],
    queryFn: async () => (await api.get("/reports/stockout-risk", { params: { lead_time_days: leadTime } })).data,
  });

  const [topDays, setTopDays] = useState<number | "all">("all");
  const { data: topCustomers, isLoading: topCustomersLoading, isError: topCustomersError } = useQuery<TopCustomersReport>({
    queryKey: ["reports", "top-customers", topDays],
    queryFn: async () => {
      const params: Record<string, string> = { limit: "25" };
      if (topDays !== "all") params.days = String(topDays);
      return (await api.get("/reports/top-customers", { params })).data;
    },
  });

  const { data: topSuppliers, isLoading: topSuppliersLoading, isError: topSuppliersError } = useQuery<TopSuppliersReport>({
    queryKey: ["reports", "top-suppliers", topDays],
    queryFn: async () => {
      const params: Record<string, string> = { limit: "25" };
      if (topDays !== "all") params.days = String(topDays);
      return (await api.get("/reports/top-suppliers", { params })).data;
    },
  });

  const { data: mfgCost, isLoading: mfgCostLoading, isError: mfgCostError } = useQuery<ManufacturingCostReport>({
    queryKey: ["costing", "report"],
    queryFn: async () => (await api.get("/costing/report")).data,
  });

  const exportCsv = async (path: string, filename: string) => {
    if (dateInvalid) return;
    try {
      const { data } = await api.get(path, { params: rangeParams(), responseType: "blob" });
      downloadBlob(data, filename);
      addToast(`${filename} downloaded`, "success");
    } catch {
      addToast("Failed to export CSV", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-ink">Reports & Analytics</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="input text-sm py-1.5"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
          />
          <span className="text-faint text-sm">to</span>
          <input
            type="date"
            className="input text-sm py-1.5"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(""); setEndDate(""); }}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400 underline"
              aria-label="Clear date range"
            >
              Clear
            </button>
          )}
          <button onClick={() => exportCsv("/reports/export/sales", "sales_report.csv")} disabled={dateInvalid} className="btn-secondary text-sm py-1.5 flex items-center gap-1" aria-label="Export sales CSV">
            Export Sales
          </button>
          <button onClick={() => exportCsv("/reports/export/movements", "stock_movements_report.csv")} disabled={dateInvalid} className="btn-secondary text-sm py-1.5 flex items-center gap-1" aria-label="Export movements CSV">
            Export Movements
          </button>
        </div>
      </div>

      {dateInvalid && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg text-sm" role="alert">
          Start date must be before end date. Adjust the range to load report data.
        </div>
      )}

      <div className="flex gap-1 bg-subtle p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === t.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "valuation" && (valuation
        ? <ValuationTab data={valuation} symbol={currencySymbol} />
        : <TabState isLoading={valuationLoading} isError={valuationError} />)}
      {activeTab === "movements" && (movements
        ? <MovementsTab data={movements} hasRange={!!startDate || !!endDate} />
        : <TabState isLoading={movementsLoading} isError={movementsError} />)}
      {activeTab === "categories" && (categories
        ? <CategoriesTab data={categories} symbol={currencySymbol} />
        : <TabState isLoading={categoriesLoading} isError={categoriesError} />)}
      {activeTab === "profit" && (profit
        ? <ProfitTab data={profit} symbol={currencySymbol} />
        : <TabState isLoading={profitLoading} isError={profitError} />)}
      {activeTab === "orders" && (orderSummary
        ? <OrdersTab data={orderSummary} symbol={currencySymbol} />
        : <TabState isLoading={orderSummaryLoading} isError={orderSummaryError} />)}
      {activeTab === "sales" && (salesSummary
        ? <SalesTab data={salesSummary} symbol={currencySymbol} />
        : <TabState isLoading={salesLoading} isError={salesError} />)}
      {activeTab === "aging" && (aging
        ? <AgingTab data={aging} />
        : <TabState isLoading={agingLoading} isError={agingError} />)}
      {activeTab === "stockout" && (stockout
        ? <StockoutTab data={stockout} leadTime={leadTime} onLeadTimeChange={setLeadTime} />
        : <TabState isLoading={stockoutLoading} isError={stockoutError} />)}
      {activeTab === "customers" && (topCustomers
        ? <CustomersTab data={topCustomers} symbol={currencySymbol} days={topDays} onDaysChange={setTopDays} />
        : <TabState isLoading={topCustomersLoading} isError={topCustomersError} />)}
      {activeTab === "suppliers" && (topSuppliers
        ? <SuppliersTab data={topSuppliers} symbol={currencySymbol} days={topDays} onDaysChange={setTopDays} />
        : <TabState isLoading={topSuppliersLoading} isError={topSuppliersError} />)}
      {activeTab === "manufacturing-cost" && (mfgCost
        ? <ManufacturingCostTab data={mfgCost} symbol={currencySymbol} />
        : <TabState isLoading={mfgCostLoading} isError={mfgCostError} />)}
    </div>
  );
}

function ManufacturingCostTab({ data, symbol }: { data: ManufacturingCostReport; symbol: string }) {
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
                <th className="px-4 py-3 font-medium text-muted">WO #</th>
                <th className="px-4 py-3 font-medium text-muted">Product</th>
                <th className="px-4 py-3 font-medium text-muted">Qty</th>
                <th className="px-4 py-3 font-medium text-muted">Completed</th>
                <th className="px-4 py-3 font-medium text-muted text-right">Material Cost</th>
                <th className="px-4 py-3 font-medium text-muted text-right">Std / Unit</th>
                <th className="px-4 py-3 font-medium text-muted text-right">Actual / Unit</th>
                <th className="px-4 py-3 font-medium text-muted text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No completed work orders</td></tr>
              ) : data.items.map((row) => (
                <tr key={row.wo_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">{row.wo_number}</td>
                  <td className="px-4 py-3 text-muted">{row.product_name}</td>
                  <td className="px-4 py-3">{row.quantity}</td>
                  <td className="px-4 py-3 text-muted">{row.completed_at ? new Date(row.completed_at).toLocaleDateString() : "—"}</td>
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

function AgingTab({ data }: { data: InventoryAging }) {
  const maxAge = Math.max(...data.items.map((i) => i.age_days), 0);
  const buckets = [
    { label: "< 30 days", min: 0, max: 29 },
    { label: "30-89 days", min: 30, max: 89 },
    { label: "90-179 days", min: 90, max: 179 },
    { label: "180+ days", min: 180, max: Infinity },
  ].map((b) => {
    const rows = data.items.filter((i) => i.age_days >= b.min && i.age_days <= b.max);
    return { ...b, count: rows.length, quantity: rows.reduce((s, r) => s + r.on_hand, 0) };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {buckets.map((b) => (
          <div key={b.label} className="card">
            <p className="text-sm text-muted">{b.label}</p>
            <p className="text-2xl font-bold mt-1">{b.count}</p>
            <p className="text-xs text-faint">{b.quantity} units</p>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Inventory Age ({data.total} lots with stock)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-3 font-medium text-muted">Lot</th>
                <th className="px-4 py-3 font-medium text-muted">Product</th>
                <th className="px-4 py-3 font-medium text-muted">On Hand</th>
                <th className="px-4 py-3 font-medium text-muted">Age (days)</th>
                <th className="px-4 py-3 font-medium text-muted">Last Movement</th>
                <th className="px-4 py-3 font-medium text-muted">Avg Daily Demand</th>
                <th className="px-4 py-3 font-medium text-muted">Days of Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No lot-level stock</td></tr>
              ) : data.items.map((row) => {
                const pct = maxAge > 0 ? (row.age_days / maxAge) * 100 : 0;
                const color = row.age_days >= 180 ? "bg-red-500" : row.age_days >= 90 ? "bg-amber-500" : row.age_days >= 30 ? "bg-yellow-400" : "bg-green-500";
                return (
                  <tr key={row.lot_id} className="hover:bg-app">
                    <td className="px-4 py-3 font-medium">{row.lot_number}</td>
                    <td className="px-4 py-3 text-muted">{row.product_name}</td>
                    <td className="px-4 py-3">{row.on_hand}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-subtle rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-xs">{row.age_days}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.last_movement_at ? new Date(row.last_movement_at).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-3 text-muted">{row.avg_daily_demand.toFixed(2)}</td>
                    <td className="px-4 py-3">{row.days_of_stock != null ? row.days_of_stock.toFixed(1) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StockoutTab({ data, leadTime, onLeadTimeChange }: { data: StockoutRisk; leadTime: number; onLeadTimeChange: (n: number) => void }) {
  const badge = (level: string) =>
    level === "high" ? "badge-danger" : level === "medium" ? "badge-warning" : "badge-success";
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card"><p className="text-sm text-muted">High Risk</p><p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{data.summary.high}</p></div>
          <div className="card"><p className="text-sm text-muted">Medium Risk</p><p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{data.summary.medium}</p></div>
          <div className="card"><p className="text-sm text-muted">Low Risk</p><p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">{data.summary.low}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor="lead-time">Lead time (days)</label>
          <select id="lead-time" className="select w-24" value={leadTime} onChange={(e) => onLeadTimeChange(Number(e.target.value))}>
            {[3, 5, 7, 10, 14, 21, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-3 font-medium text-muted">Product</th>
                <th className="px-4 py-3 font-medium text-muted">SKU</th>
                <th className="px-4 py-3 font-medium text-muted">On Hand</th>
                <th className="px-4 py-3 font-medium text-muted">Avg Daily Demand</th>
                <th className="px-4 py-3 font-medium text-muted">Days of Supply</th>
                <th className="px-4 py-3 font-medium text-muted">Suggested Reorder</th>
                <th className="px-4 py-3 font-medium text-muted">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No products</td></tr>
              ) : data.items.map((p) => (
                <tr key={p.product_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">{p.product_name}</td>
                  <td className="px-4 py-3 text-muted">{p.sku}</td>
                  <td className="px-4 py-3">{p.on_hand}</td>
                  <td className="px-4 py-3 text-muted">{p.avg_daily_demand.toFixed(2)}</td>
                  <td className="px-4 py-3">{p.days_of_supply != null ? p.days_of_supply.toFixed(1) : "—"}</td>
                  <td className="px-4 py-3">{p.suggested_reorder}</td>
                  <td className="px-4 py-3"><span className={`badge ${badge(p.risk_level)}`}>{p.risk_level}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ValuationTab({ data, symbol }: { data: InventoryValuation; symbol: string }) {
  const cards = [
    { label: "Inventory Value (Cost)", value: formatCurrency(data.total_inventory_value, symbol, 0), },
    { label: "Retail Value", value: formatCurrency(data.total_retail_value, symbol, 0) },
    { label: "Potential Profit", value: formatCurrency(data.potential_profit, symbol, 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted">{c.label}</p>
                <p className="text-2xl font-bold mt-1">{c.value}</p>
              </div>
            </div>
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

function MovementsTab({ data, hasRange }: { data: StockMovementTrends; hasRange?: boolean }) {
  const label = hasRange ? "Selected Range" : "30d";
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Stock In ({label})</p><p className="text-2xl font-bold mt-1">{data.total_in.toLocaleString()}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Stock Out ({label})</p><p className="text-2xl font-bold mt-1">{data.total_out.toLocaleString()}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Net Movement</p><p className={`text-2xl font-bold mt-1 ${data.net_movement >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>{data.net_movement >= 0 ? "+" : ""}{data.net_movement.toLocaleString()}</p></div>
          </div>
        </div>
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

function CategoriesTab({ data, symbol }: { data: CategoryBreakdownItem[]; symbol: string }) {
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
                    <th className="px-4 py-3 font-medium text-muted">Category</th>
                    <th className="px-4 py-3 font-medium text-muted">Products</th>
                    <th className="px-4 py-3 font-medium text-muted">Total Stock</th>
                    <th className="px-4 py-3 font-medium text-muted">Cost Value</th>
                    <th className="px-4 py-3 font-medium text-muted">Retail Value</th>
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

function ProfitTab({ data, symbol }: { data: ProfitAnalysis; symbol: string }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Total Cost</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_cost_value, symbol, 0)}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Potential Revenue</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_potential_revenue, symbol, 0)}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Potential Profit</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_potential_profit, symbol, 0)}</p></div>
          </div>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-3 font-medium text-muted">Product</th>
                <th className="px-4 py-3 font-medium text-muted">SKU</th>
                <th className="px-4 py-3 font-medium text-muted">Qty</th>
                <th className="px-4 py-3 font-medium text-muted">Unit Cost</th>
                <th className="px-4 py-3 font-medium text-muted">Unit Price</th>
                <th className="px-4 py-3 font-medium text-muted">Margin</th>
                <th className="px-4 py-3 font-medium text-muted">Total Profit</th>
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

function SalesTab({ data, symbol }: { data: SalesSummary; symbol: string }) {
  const cards = [
    { label: "Completed Sales", value: data.total_sales.toString(), },
    { label: "Total Revenue", value: formatCurrency(data.total_revenue, symbol, 2), },
    { label: "Tax Collected", value: formatCurrency(data.total_tax, symbol, 2),  },
    { label: "Refunds", value: data.total_refunds.toString(), },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted">{c.label}</p>
                <p className="text-2xl font-bold mt-1">{c.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Sales by Payment Method</h3>
          {data.by_payment_method.length === 0 ? (
            <p className="text-muted text-sm">No sales in period</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={data.by_payment_method} dataKey="count" nameKey="method" cx="50%" cy="50%" outerRadius={90} label={({ name, value }: any) => `${name}: ${value}`}>
                  {data.by_payment_method.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card overflow-hidden p-0">
          <h3 className="text-lg font-semibold px-4 pt-4 pb-2">Top Selling Products</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-3 font-medium text-muted">Product</th>
                  <th className="px-4 py-3 font-medium text-muted">Units Sold</th>
                  <th className="px-4 py-3 font-medium text-muted">Revenue</th>
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
    </div>
  );
}

function OrdersTab({ data, symbol }: { data: OrderSummary; symbol: string }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Total Orders</p><p className="text-2xl font-bold mt-1">{data.total_orders}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div><p className="text-sm text-muted">Total Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_order_value, symbol, 0)}</p></div>
          </div>
        </div>
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
                  {data.by_status.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
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

function CustomersTab({ data, symbol, days, onDaysChange }: {
  data: TopCustomersReport;
  symbol: string;
  days: number | "all";
  onDaysChange: (d: number | "all") => void;
}) {
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
          <select id="top-days" className="select w-32" value={days} onChange={(e) => onDaysChange(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-3 font-medium text-muted">#</th>
                <th className="px-4 py-3 font-medium text-muted">Customer</th>
                <th className="px-4 py-3 font-medium text-muted">Phone</th>
                <th className="px-4 py-3 font-medium text-muted">Orders</th>
                <th className="px-4 py-3 font-medium text-muted">Total Spent</th>
                <th className="px-4 py-3 font-medium text-muted">Last Purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No customer sales data</td></tr>
              ) : data.items.map((c, i) => (
                <tr key={c.customer_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium text-faint">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-muted">{c.phone}</td>
                  <td className="px-4 py-3">{c.total_sales}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-subtle rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxSpent > 0 ? Math.min((c.total_spent / maxSpent) * 100, 100) : 0}%` }} />
                      </div>
                      <span>{formatCurrency(c.total_spent, symbol)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SuppliersTab({ data, symbol, days, onDaysChange }: {
  data: TopSuppliersReport;
  symbol: string;
  days: number | "all";
  onDaysChange: (d: number | "all") => void;
}) {
  const maxSpent = Math.max(...data.items.map((s) => s.total_spent), 0);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card"><p className="text-sm text-muted">Top Suppliers</p><p className="text-2xl font-bold mt-1">{data.total}</p></div>
          <div className="card"><p className="text-sm text-muted">Top Supplier</p><p className="text-2xl font-bold mt-1">{data.items[0]?.name || "—"}</p></div>
          <div className="card"><p className="text-sm text-muted">Top Supplier Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.items[0]?.total_spent ?? 0, symbol)}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor="top-sup-days">Period</label>
          <select id="top-sup-days" className="select w-32" value={days} onChange={(e) => onDaysChange(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-3 font-medium text-muted">#</th>
                <th className="px-4 py-3 font-medium text-muted">Supplier</th>
                <th className="px-4 py-3 font-medium text-muted">Contact</th>
                <th className="px-4 py-3 font-medium text-muted">Orders</th>
                <th className="px-4 py-3 font-medium text-muted">Total Spent</th>
                <th className="px-4 py-3 font-medium text-muted">Last Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No supplier order data</td></tr>
              ) : data.items.map((s, i) => (
                <tr key={s.supplier_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium text-faint">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-muted">{s.contact_person}</td>
                  <td className="px-4 py-3">{s.total_orders}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-subtle rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxSpent > 0 ? Math.min((s.total_spent / maxSpent) * 100, 100) : 0}%` }} />
                      </div>
                      <span>{formatCurrency(s.total_spent, symbol)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{s.last_order_at ? new Date(s.last_order_at).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
