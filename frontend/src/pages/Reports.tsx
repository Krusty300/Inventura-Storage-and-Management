import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import {
  DollarSign, Package, TrendingUp, ShoppingCart,
  ArrowUpRight, ArrowDownRight, Receipt
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type {
  InventoryValuation, StockMovementTrends, CategoryBreakdownItem,
  ProfitAnalysis, OrderSummary, SalesSummary, InventoryAging, StockoutRisk,
  TopCustomersReport, TopSuppliersReport,
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
      <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
        Failed to load report data.
      </div>
    );
  }
  return null;
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState<Tab>("valuation");
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

  const [leadTime, setLeadTime] = useState(7);
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
        <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="input text-sm py-1.5"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
          />
          <span className="text-gray-400 text-sm">to</span>
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
              className="text-sm text-indigo-600 hover:text-indigo-800 underline"
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
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm" role="alert">
          Start date must be before end date. Adjust the range to load report data.
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
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
            <p className="text-sm text-gray-500">{b.label}</p>
            <p className="text-2xl font-bold mt-1">{b.count}</p>
            <p className="text-xs text-gray-400">{b.quantity} units</p>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Inventory Age ({data.total} lots with stock)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Lot</th>
                <th className="px-4 py-3 font-medium text-gray-600">Product</th>
                <th className="px-4 py-3 font-medium text-gray-600">On Hand</th>
                <th className="px-4 py-3 font-medium text-gray-600">Age (days)</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Movement</th>
                <th className="px-4 py-3 font-medium text-gray-600">Avg Daily Demand</th>
                <th className="px-4 py-3 font-medium text-gray-600">Days of Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">No lot-level stock</td></tr>
              ) : data.items.map((row) => {
                const pct = maxAge > 0 ? (row.age_days / maxAge) * 100 : 0;
                const color = row.age_days >= 180 ? "bg-red-500" : row.age_days >= 90 ? "bg-amber-500" : row.age_days >= 30 ? "bg-yellow-400" : "bg-green-500";
                return (
                  <tr key={row.lot_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{row.lot_number}</td>
                    <td className="px-4 py-3 text-gray-500">{row.product_name}</td>
                    <td className="px-4 py-3">{row.on_hand}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-xs">{row.age_days}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{row.last_movement_at ? new Date(row.last_movement_at).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-3 text-gray-500">{row.avg_daily_demand.toFixed(2)}</td>
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
          <div className="card"><p className="text-sm text-gray-500">High Risk</p><p className="text-2xl font-bold mt-1 text-red-600">{data.summary.high}</p></div>
          <div className="card"><p className="text-sm text-gray-500">Medium Risk</p><p className="text-2xl font-bold mt-1 text-amber-600">{data.summary.medium}</p></div>
          <div className="card"><p className="text-sm text-gray-500">Low Risk</p><p className="text-2xl font-bold mt-1 text-green-600">{data.summary.low}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600" htmlFor="lead-time">Lead time (days)</label>
          <select id="lead-time" className="select w-24" value={leadTime} onChange={(e) => onLeadTimeChange(Number(e.target.value))}>
            {[3, 5, 7, 10, 14, 21, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Product</th>
                <th className="px-4 py-3 font-medium text-gray-600">SKU</th>
                <th className="px-4 py-3 font-medium text-gray-600">On Hand</th>
                <th className="px-4 py-3 font-medium text-gray-600">Avg Daily Demand</th>
                <th className="px-4 py-3 font-medium text-gray-600">Days of Supply</th>
                <th className="px-4 py-3 font-medium text-gray-600">Suggested Reorder</th>
                <th className="px-4 py-3 font-medium text-gray-600">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">No products</td></tr>
              ) : data.items.map((p) => (
                <tr key={p.product_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.product_name}</td>
                  <td className="px-4 py-3 text-gray-500">{p.sku}</td>
                  <td className="px-4 py-3">{p.on_hand}</td>
                  <td className="px-4 py-3 text-gray-500">{p.avg_daily_demand.toFixed(2)}</td>
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
    { label: "Inventory Value (Cost)", value: formatCurrency(data.total_inventory_value, symbol, 0), icon: DollarSign, color: "bg-indigo-500" },
    { label: "Retail Value", value: formatCurrency(data.total_retail_value, symbol, 0), icon: Package, color: "bg-emerald-500" },
    { label: "Potential Profit", value: formatCurrency(data.potential_profit, symbol, 0), icon: TrendingUp, color: "bg-green-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{c.label}</p>
                <p className="text-2xl font-bold mt-1">{c.value}</p>
              </div>
              <div className={`${c.color} p-3 rounded-lg`}>
                <c.icon className="text-white" size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Value by Category</h3>
          {data.by_category.length === 0 ? (
            <p className="text-gray-500 text-sm">No data</p>
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
            <p className="text-gray-500 text-sm">No data</p>
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
            <div className="bg-green-500 p-3 rounded-lg"><ArrowUpRight className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Stock In ({label})</p><p className="text-2xl font-bold mt-1">{data.total_in.toLocaleString()}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="bg-red-500 p-3 rounded-lg"><ArrowDownRight className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Stock Out ({label})</p><p className="text-2xl font-bold mt-1">{data.total_out.toLocaleString()}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${data.net_movement >= 0 ? "bg-emerald-500" : "bg-orange-500"}`}><Package className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Net Movement</p><p className={`text-2xl font-bold mt-1 ${data.net_movement >= 0 ? "text-emerald-600" : "text-orange-600"}`}>{data.net_movement >= 0 ? "+" : ""}{data.net_movement.toLocaleString()}</p></div>
          </div>
        </div>
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Daily Stock Movement Trends</h3>
        {data.daily_trends.length === 0 ? (
          <p className="text-gray-500 text-sm">No movements in the selected period</p>
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
          <p className="text-gray-500 text-sm">No categories</p>
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
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">Category</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Products</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Total Stock</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Cost Value</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Retail Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
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
            <div className="bg-red-500 p-3 rounded-lg"><DollarSign className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Total Cost</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_cost_value, symbol, 0)}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500 p-3 rounded-lg"><TrendingUp className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Potential Revenue</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_potential_revenue, symbol, 0)}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="bg-green-500 p-3 rounded-lg"><Package className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Potential Profit</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_potential_profit, symbol, 0)}</p></div>
          </div>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Product</th>
                <th className="px-4 py-3 font-medium text-gray-600">SKU</th>
                <th className="px-4 py-3 font-medium text-gray-600">Qty</th>
                <th className="px-4 py-3 font-medium text-gray-600">Unit Cost</th>
                <th className="px-4 py-3 font-medium text-gray-600">Unit Price</th>
                <th className="px-4 py-3 font-medium text-gray-600">Margin</th>
                <th className="px-4 py-3 font-medium text-gray-600">Total Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.products.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-gray-500">{p.sku}</td>
                  <td className="px-4 py-3">{p.quantity}</td>
                  <td className="px-4 py-3">{formatCurrency(p.unit_cost, symbol)}</td>
                  <td className="px-4 py-3">{formatCurrency(p.unit_price, symbol)}</td>
                  <td className="px-4 py-3">
                    <span className={p.margin_percentage >= 0 ? "text-green-600" : "text-red-600"}>
                      {p.margin_percentage >= 0 ? "+" : ""}{p.margin_percentage}%
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-medium ${p.total_profit >= 0 ? "text-green-600" : "text-red-600"}`}>
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
    { label: "Completed Sales", value: data.total_sales.toString(), icon: ShoppingCart, color: "bg-indigo-500" },
    { label: "Total Revenue", value: formatCurrency(data.total_revenue, symbol, 2), icon: DollarSign, color: "bg-emerald-500" },
    { label: "Tax Collected", value: formatCurrency(data.total_tax, symbol, 2), icon: TrendingUp, color: "bg-amber-500" },
    { label: "Refunds", value: data.total_refunds.toString(), icon: Receipt, color: "bg-red-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{c.label}</p>
                <p className="text-2xl font-bold mt-1">{c.value}</p>
              </div>
              <div className={`${c.color} p-3 rounded-lg`}>
                <c.icon className="text-white" size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Sales by Payment Method</h3>
          {data.by_payment_method.length === 0 ? (
            <p className="text-gray-500 text-sm">No sales in period</p>
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
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Product</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Units Sold</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.top_products.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-500">No sales data</td></tr>
                ) : data.top_products.map((p) => (
                  <tr key={p.name} className="hover:bg-gray-50">
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
            <div className="bg-indigo-500 p-3 rounded-lg"><ShoppingCart className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Total Orders</p><p className="text-2xl font-bold mt-1">{data.total_orders}</p></div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500 p-3 rounded-lg"><DollarSign className="text-white" size={24} /></div>
            <div><p className="text-sm text-gray-500">Total Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.total_order_value, symbol, 0)}</p></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Orders by Status</h3>
          {data.by_status.length === 0 ? (
            <p className="text-gray-500 text-sm">No orders</p>
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
            <p className="text-gray-500 text-sm">No suppliers</p>
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
          <div className="card"><p className="text-sm text-gray-500">Top Customers</p><p className="text-2xl font-bold mt-1">{data.total}</p></div>
          <div className="card"><p className="text-sm text-gray-500">Top Spender</p><p className="text-2xl font-bold mt-1">{data.items[0]?.name || "—"}</p></div>
          <div className="card"><p className="text-sm text-gray-500">Top Customer Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.items[0]?.total_spent ?? 0, symbol)}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600" htmlFor="top-days">Period</label>
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
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">#</th>
                <th className="px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 font-medium text-gray-600">Orders</th>
                <th className="px-4 py-3 font-medium text-gray-600">Total Spent</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No customer sales data</td></tr>
              ) : data.items.map((c, i) => (
                <tr key={c.customer_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone}</td>
                  <td className="px-4 py-3">{c.total_sales}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxSpent > 0 ? Math.min((c.total_spent / maxSpent) * 100, 100) : 0}%` }} />
                      </div>
                      <span>{formatCurrency(c.total_spent, symbol)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString() : "Never"}</td>
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
          <div className="card"><p className="text-sm text-gray-500">Top Suppliers</p><p className="text-2xl font-bold mt-1">{data.total}</p></div>
          <div className="card"><p className="text-sm text-gray-500">Top Supplier</p><p className="text-2xl font-bold mt-1">{data.items[0]?.name || "—"}</p></div>
          <div className="card"><p className="text-sm text-gray-500">Top Supplier Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(data.items[0]?.total_spent ?? 0, symbol)}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600" htmlFor="top-sup-days">Period</label>
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
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">#</th>
                <th className="px-4 py-3 font-medium text-gray-600">Supplier</th>
                <th className="px-4 py-3 font-medium text-gray-600">Contact</th>
                <th className="px-4 py-3 font-medium text-gray-600">Orders</th>
                <th className="px-4 py-3 font-medium text-gray-600">Total Spent</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No supplier order data</td></tr>
              ) : data.items.map((s, i) => (
                <tr key={s.supplier_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500">{s.contact_person}</td>
                  <td className="px-4 py-3">{s.total_orders}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxSpent > 0 ? Math.min((s.total_spent / maxSpent) * 100, 100) : 0}%` }} />
                      </div>
                      <span>{formatCurrency(s.total_spent, symbol)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.last_order_at ? new Date(s.last_order_at).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
