import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Package,
  Factory,
  PackagePlus,
  Truck,
  ShoppingCart,
  ReceiptText,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend } from "recharts";
import api from "../api/client";
import type {
  DashboardStats,
  InventoryValuation,
  SalesStats,
  StockMovementTrends,
  ExceptionsReport,
  StockoutRisk,
  LPN,
  Receipt,
  OrderSummary,
  ProfitAnalysis,
  SalesSummary,
  ManufacturingCostReport,
  PaginatedResponse,
} from "../types";
import { parseLocalDate } from "../utils/date";
import { formatCurrency } from "../utils/currency";
import { can } from "../utils/permissions";
import { useSettings } from "../hooks/useSettings";
import { useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

const TREND_OPTIONS = [7, 30, 90];

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [trends, setTrends] = useState<StockMovementTrends | null>(null);
  const [valuation, setValuation] = useState<InventoryValuation | null>(null);
  const [salesStats, setSalesStats] = useState<SalesStats | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionsReport | null>(null);
  const [stockoutRisk, setStockoutRisk] = useState<StockoutRisk | null>(null);
  const [lpns, setLpns] = useState<PaginatedResponse<LPN> | null>(null);
  const [receipts, setReceipts] = useState<PaginatedResponse<Receipt> | null>(null);
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [profit, setProfit] = useState<ProfitAnalysis | null>(null);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [costReport, setCostReport] = useState<ManufacturingCostReport | null>(null);
  const [trendDays, setTrendDays] = useState(30);
  const [topProductsDays, setTopProductsDays] = useState(30);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const get = useCallback(async <T,>(url: string): Promise<T | null> => {
    try {
      const res = await api.get(url);
      return res.data as T;
    } catch {
      return null;
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setError("");
    setRefreshing(true);
    try {
      const statsRes = await api.get("/dashboard/stats");
      setStats(statsRes.data);
    } catch {
      setError("Failed to load dashboard data");
      addToast("Failed to load dashboard data", "error");
      setRefreshing(false);
      return;
    }
    const [salesData, valData, excData, riskData, lpnData, recData, ordData, profData, costData] = await Promise.all([
      get<SalesStats>("/sales/stats"),
      get<InventoryValuation>("/reports/inventory-valuation"),
      get<ExceptionsReport>("/reports/exceptions"),
      get<StockoutRisk>("/reports/stockout-risk"),
      get<PaginatedResponse<LPN>>("/lpns?limit=20"),
      get<PaginatedResponse<Receipt>>("/receipts?limit=20"),
      get<OrderSummary>("/reports/order-summary"),
      get<ProfitAnalysis>("/reports/profit-analysis"),
      get<ManufacturingCostReport>("/costing/report"),
    ]);
    setSalesStats(salesData);
    setValuation(valData);
    setExceptions(excData);
    setStockoutRisk(riskData);
    setLpns(lpnData);
    setReceipts(recData);
    setOrderSummary(ordData);
    setProfit(profData);
    setCostReport(costData);
    setRefreshing(false);
  }, [get, addToast]);

  const fetchTrends = useCallback(async () => {
    const t = await get<StockMovementTrends>(`/reports/stock-movement-trends?days=${trendDays}`);
    setTrends(t);
  }, [get, trendDays]);

  const fetchTopProducts = useCallback(async () => {
    const start = new Date(Date.now() - topProductsDays * 86400000).toISOString().slice(0, 10);
    const s = await get<SalesSummary>(`/reports/sales-summary?start_date=${start}`);
    setSalesSummary(s);
  }, [get, topProductsDays]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchTrends(); }, [fetchTrends]);
  useEffect(() => { fetchTopProducts(); }, [fetchTopProducts]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      fetchStats();
      fetchTrends();
      fetchTopProducts();
    }, 60000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchStats, fetchTrends, fetchTopProducts]);

  const exportPdf = () => {
    api.get("/reports/dashboard/pdf", { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  };

  if (error && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
        <button onClick={fetchStats} className="btn-primary text-sm">Retry</button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const pendingOrders = orderSummary?.by_status.find((s) => s.status === "pending")?.count ?? 0;
  const isWorker = user?.role !== "admin";
  const greetingName = user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : "There";

  const quickActions = [
    { label: "Record Receipt", permission: "receipts.create", path: "/receiving", icon: PackagePlus },
    { label: "New ASN", permission: "asns.create", path: "/asns", icon: Truck },
    { label: "New Order", permission: "orders.create", path: "/orders", icon: ShoppingCart },
    { label: "New Sale", permission: "sales.create", path: "/sales", icon: ReceiptText },
    { label: "Create Shipment", permission: "shipments.create", path: "/shipments", icon: Package },
    { label: "Release Work Order", permission: "work_orders.release", path: "/work-orders", icon: Factory },
    { label: "New Cycle Count", permission: "cycle_counts.create", path: "/cycle-counts", icon: ClipboardList },
    { label: "New QC", permission: "quality_checks.create", path: "/quality-checks", icon: ShieldCheck },
  ];

  const inventoryCards = [
    { label: "Total Products", value: stats.total_products, link: "/products" },
    {
      label: "Inventory Value",
      value: formatCurrency(stats.total_inventory_value, currencySymbol, 0),
      link: "/reports",
    },
    { label: "Low Stock Items", value: stats.low_stock_count, link: "/products?low_stock=1" },
    { label: "Expiring Soon", value: stats.expiring_soon_count, link: "/products" },
    { label: "Quarantined Units", value: stats.quarantined_units ?? 0, link: "/exceptions" },
    { label: "Serial Numbers in Stock", value: stats.serial_numbers_in_stock ?? 0, link: "/serial-numbers" },
    { label: "Movements Today", value: stats.total_stock_movements_today, link: "/stock-movements" },
    { label: "LPNs", value: lpns?.total ?? 0, link: "/lpns" },
    { label: "Receipts", value: receipts?.total ?? 0, link: "/receiving" },
  ];

  const fulfillmentCards = [
    { label: "Open Shipments", value: stats.open_shipments ?? 0, link: "/shipments" },
    { label: "Pending Orders", value: pendingOrders, link: "/orders" },
    { label: "Pending ASNs", value: exceptions?.summary?.pending_asns ?? 0, link: "/asns" },
    { label: "Open Cycle Counts", value: exceptions?.summary?.open_cycle_counts ?? 0, link: "/cycle-counts" },
    {
      label: "Total Revenue",
      value: formatCurrency(salesStats?.total_revenue || 0, currencySymbol, 0),
      link: "/sales",
    },
  ];

  const manufacturingCards = [
    { label: "Open Work Orders", value: stats.open_work_orders ?? 0, link: "/work-orders" },
    { label: "Pending QC", value: stats.pending_quality_checks ?? 0, link: "/quality-checks" },
  ];

  const businessCards = [
    { label: "Orders", value: stats.total_orders, link: "/orders" },
    { label: "Categories", value: stats.total_categories },
    { label: "Suppliers", value: stats.total_suppliers },
  ];

  const statSections = [
    { title: "Inventory", cards: inventoryCards },
    { title: "Fulfillment", cards: fulfillmentCards },
    { title: "Manufacturing", cards: manufacturingCards },
    { title: "Business", cards: businessCards },
  ];

  const trendData = trends?.daily_trends?.slice(-14) || [];
  const riskSummary = stockoutRisk?.summary;
  const topProducts = salesSummary?.top_products?.slice(0, 5) || [];
  const topProfitProducts = profit?.products?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{isWorker ? `Welcome Back, ${greetingName}` : `Good to see you, ${greetingName}`}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-border-strong"
            />
            Auto-refresh (60s)
          </label>
          <button onClick={exportPdf} className="btn-secondary inline-flex items-center gap-2" aria-label="Export dashboard PDF">
            pdf
          </button>
          <button onClick={fetchStats} disabled={refreshing} className="btn-secondary" aria-label="Refresh dashboard">
            {refreshing ? "refreshing…" : "refresh"}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions
            .filter((a) => can(user?.role, a.permission))
            .map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.path)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:hover:border-indigo-400/60 transition-colors text-sm font-medium text-ink"
              >
                <a.icon size={18} className="text-indigo-600 dark:text-indigo-400" />
                {a.label}
              </button>
            ))}
        </div>
      </div>

      {riskSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button onClick={() => navigate("/reports")} className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-500 text-left">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-red-500" size={16} />
              <p className="text-sm text-muted">High Stockout Risk</p>
            </div>
            <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{riskSummary.high}</p>
          </button>
          <button onClick={() => navigate("/reports")} className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-amber-400 text-left">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={16} />
              <p className="text-sm text-muted">Medium Stockout Risk</p>
            </div>
            <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{riskSummary.medium}</p>
          </button>
          <button onClick={() => navigate("/reports")} className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-emerald-400 text-left">
            <p className="text-sm text-muted">Low Stockout Risk</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{riskSummary.low}</p>
          </button>
        </div>
      )}

      {statSections.map((section) => (
        <div key={section.title} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{section.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {section.cards.map((card) => (
              <div
                key={card.label}
                onClick={() => card.link && navigate(card.link)}
                className={`card ${card.link ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
              >
                <p className="text-sm text-muted">{card.label}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Stock Movement Trends ({trendDays} days)</h2>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {TREND_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setTrendDays(d)}
                  className={`px-3 py-1 text-xs font-medium ${trendDays === d ? "bg-indigo-600 text-white" : "text-muted hover:bg-app"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5) || ""} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="in" stroke="#22c55e" name="Stock In" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="out" stroke="#ef4444" name="Stock Out" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No stock movements in this period</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Inventory Value by Category</h2>
          {valuation?.by_category && valuation.by_category.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={valuation.by_category.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="total_value" fill="#6366f1" name={`Value (${currencySymbol})`} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No category valuation data</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Top Products</h2>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {TREND_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setTopProductsDays(d)}
                  className={`px-3 py-1 text-xs font-medium ${topProductsDays === d ? "bg-indigo-600 text-white" : "text-muted hover:bg-app"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.map((p) => (
                <div key={p.name} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{p.name}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-muted">{p.quantity_sold} sold</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatCurrency(p.revenue, currencySymbol)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No sales in this period</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Profit Analysis</h2>
          {profit ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted">Total Cost</p>
                  <p className="text-lg font-bold">{formatCurrency(profit.total_cost_value, currencySymbol, 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">Potential Revenue</p>
                  <p className="text-lg font-bold">{formatCurrency(profit.total_potential_revenue, currencySymbol, 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">Potential Profit</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(profit.total_potential_profit, currencySymbol, 0)}</p>
                </div>
              </div>
              {topProfitProducts.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-muted">Top Margin Products</p>
                  {topProfitProducts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatCurrency(p.total_profit, currencySymbol)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No profit data</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Pending ASNs</h2>
            <button onClick={() => navigate("/asns")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {exceptions?.pending_asns?.length ? (
            <div className="space-y-3">
              {exceptions.pending_asns.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{a.asn_number}</span>
                    <span className="text-muted ml-2">{a.supplier}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {a.expected_arrival && (
                      <span className="text-muted">{parseLocalDate(a.expected_arrival).toLocaleDateString()}</span>
                    )}
                    <span className="text-amber-600 dark:text-amber-400 font-medium">{a.items_pending} pending</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No pending ASNs</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Open Cycle Counts</h2>
            <button onClick={() => navigate("/cycle-counts")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {exceptions?.open_cycle_counts?.length ? (
            <div className="space-y-3">
              {exceptions.open_cycle_counts.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{c.cc_number}</span>
                    <span className="text-muted ml-2">{c.location}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === "in_progress" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-subtle text-muted"}`}>
                      {c.status}
                    </span>
                    {c.total_variance !== 0 && (
                      <span className={`font-medium ${c.total_variance > 0 ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}`}>
                        {c.total_variance > 0 ? "+" : ""}{c.total_variance} variance
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No open cycle counts</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Recent Stock Movements</h2>
          <div className="space-y-3">
            {stats.recent_movements.length === 0 && (
              <p className="text-muted text-sm">No recent movements</p>
            )}
            {stats.recent_movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {m.quantity_change > 0 ? (
                    <ArrowUpRight className="text-green-500" size={16} />
                  ) : (
                    <ArrowDownRight className="text-red-500" size={16} />
                  )}
                  <span className="font-medium">{m.product_name}</span>
                </div>
                <span className={m.quantity_change > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {m.quantity_change > 0 ? "+" : ""}
                  {m.quantity_change}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Recent Sales</h2>
          <div className="space-y-3">
            {!salesStats || salesStats.recent_sales.length === 0 ? (
              <p className="text-muted text-sm">No sales recorded yet</p>
            ) : (
              salesStats.recent_sales.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{s.invoice_number}</span>
                    <span className="text-muted ml-2">{s.customer_name}</span>
                  </div>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatCurrency(s.total_amount, currencySymbol)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Low Stock Alerts</h2>
          <div className="space-y-3">
            {stats.low_stock_products.length === 0 && (
              <p className="text-muted text-sm">All products are well-stocked</p>
            )}
            {stats.low_stock_products.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted ml-2">({p.sku})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-600 dark:text-red-400 font-medium">{p.quantity}</span>
                  <span className="text-faint">/ {p.reorder_level}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Expiring Soon</h2>
          <div className="space-y-3">
            {stats.expiring_products.length === 0 && (
              <p className="text-muted text-sm">No products expiring in the next 30 days</p>
            )}
            {stats.expiring_products.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{p.name}</span>
                  {p.batch_number && <span className="text-muted ml-2">({p.batch_number})</span>}
                </div>
                <span className={p.expiry_date < new Date().toISOString().slice(0, 10) ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-600 dark:text-amber-400 font-medium"}>
                  {parseLocalDate(p.expiry_date).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Receipts</h2>
            <button onClick={() => navigate("/receiving")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {receipts?.items?.length ? (
            <div className="space-y-3">
              {receipts.items.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{r.receipt_number}</span>
                    <span className="text-muted ml-2">{r.supplier_name || "—"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted">{r.total_quantity} units</span>
                    <span className="text-faint">{parseLocalDate(r.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No receipts recorded yet</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent LPNs</h2>
            <button onClick={() => navigate("/lpns")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {lpns?.items?.length ? (
            <div className="space-y-3">
              {lpns.items.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{l.lpn_number}</span>
                    <span className="text-muted ml-2">{l.location_name || "Unlocated"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted">{l.total_quantity} units</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-subtle text-muted"}`}>
                      {l.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No LPNs yet</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Order Status</h2>
          {orderSummary?.by_status?.length ? (
            <div className="space-y-3">
              {orderSummary.by_status.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="capitalize font-medium">{s.status}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "pending" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" : s.status === "received" ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-subtle text-muted"}`}>
                      {s.count}
                    </span>
                  </div>
                  <span className="text-muted font-medium">{formatCurrency(s.total_value, currencySymbol)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No orders yet</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Shipments to Process</h2>
            <button onClick={() => navigate("/shipments")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {stats.shipments_to_process.length > 0 ? (
            <div className="space-y-3">
              {stats.shipments_to_process.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{s.shipment_number}</span>
                    {s.customer_name && <span className="text-muted ml-2">{s.customer_name}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted">{s.total_picked}/{s.total_quantity} picked</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "packed" ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : s.status === "picking" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-subtle text-muted"}`}>
                      {s.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No shipments to process</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Open Work Orders</h2>
            <button onClick={() => navigate("/work-orders")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {stats.work_orders_to_process.length > 0 ? (
            <div className="space-y-3">
              {stats.work_orders_to_process.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{w.wo_number}</span>
                    <span className="text-muted ml-2">{w.product_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted">{w.quantity} units</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">{w.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No open work orders</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Pending Quality Checks</h2>
            <button onClick={() => navigate("/quality-checks")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {stats.quality_checks_to_process.length > 0 ? (
            <div className="space-y-3">
              {stats.quality_checks_to_process.map((q) => (
                <div key={q.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{q.qc_number}</span>
                    <span className="text-muted ml-2">{q.product_name}</span>
                  </div>
                  <span className="text-amber-600 dark:text-amber-400 font-medium">{q.result}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No pending quality checks</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Manufacturing Cost</h2>
            <button onClick={() => navigate("/reports")} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</button>
          </div>
          {costReport ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted">Material Cost</p>
                  <p className="text-lg font-bold">{formatCurrency(costReport.total_material_cost, currencySymbol, 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">Standard Cost</p>
                  <p className="text-lg font-bold">{formatCurrency(costReport.total_standard_cost, currencySymbol, 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">Variance</p>
                  <p className={`text-lg font-bold ${costReport.total_variance > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {formatCurrency(costReport.total_variance, currencySymbol, 0)}
                  </p>
                </div>
              </div>
              {costReport.items.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-muted">Latest Completed Orders</p>
                  {costReport.items.slice(0, 3).map((row) => (
                    <div key={row.wo_id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{row.wo_number}</span>
                      <span className="text-muted ml-2">{row.product_name}</span>
                      <span className="text-muted ml-auto">{formatCurrency(row.material_cost, currencySymbol)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No costing data</p>
          )}
        </div>
      </div>
    </div>
  );
}
