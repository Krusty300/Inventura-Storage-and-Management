import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { formatCurrency } from "../utils/currency";
import { canUser } from "../utils/permissions";
import { movementBadgeClass, movementLabel } from "../utils/movementTypes";
import { useSettings } from "../hooks/useSettings";
import { useNavigate } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import GlobalSearch from "../components/GlobalSearch";
import ConfirmDialog from "../components/ConfirmDialog";
import ProgressBar from "../components/ProgressBar";
import Skeleton from "../components/Skeleton";
import AttachmentSection from "../components/AttachmentSection";
import { errorMessage } from "../utils/errors";

const TREND_OPTIONS = [7, 30, 90];

const stale1m = 60 * 1000;

async function safeGet<T>(url: string, params?: Record<string, string | number>): Promise<T | null> {
  try {
    const { data } = await api.get(url, { params });
    return data as T;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status && status >= 400 && status < 500) {
      return null;
    }
    throw err;
  }
}

export default function Dashboard() {
  const formatDate = useDateFormat();
  const [trendDays, setTrendDays] = useState(30);
  const [topProductsDays, setTopProductsDays] = useState(30);
  const [riskLeadTime, setRiskLeadTime] = useState(7);
  const [confirmReorder, setConfirmReorder] = useState(false);
  const [reordering, setReordering] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const queryClient = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => (await api.get("/dashboard/stats")).data as DashboardStats,
    refetchInterval: stale1m,
  });
  const stats = statsQuery.data;

  const salesQuery = useQuery({
    queryKey: ["dashboard", "sales"],
    queryFn: () => safeGet<SalesStats>("/sales/stats"),
    refetchInterval: stale1m,
  });
  const salesStats = salesQuery.data;

  const valuationQuery = useQuery({
    queryKey: ["dashboard", "valuation"],
    queryFn: () => safeGet<InventoryValuation>("/reports/inventory-valuation"),
    refetchInterval: stale1m,
  });
  const valuation = valuationQuery.data;

  const exceptionsQuery = useQuery({
    queryKey: ["dashboard", "exceptions"],
    queryFn: () => safeGet<ExceptionsReport>("/reports/exceptions"),
    refetchInterval: stale1m,
  });
  const exceptions = exceptionsQuery.data;

  const lpnsQuery = useQuery({
    queryKey: ["dashboard", "lpns"],
    queryFn: () => safeGet<PaginatedResponse<LPN>>("/lpns", { limit: 20 }),
    refetchInterval: stale1m,
  });
  const lpns = lpnsQuery.data;

  const receiptsQuery = useQuery({
    queryKey: ["dashboard", "receipts"],
    queryFn: () => safeGet<PaginatedResponse<Receipt>>("/receipts", { limit: 20 }),
    refetchInterval: stale1m,
  });
  const receipts = receiptsQuery.data;

  const orderQuery = useQuery({
    queryKey: ["dashboard", "orderSummary"],
    queryFn: () => safeGet<OrderSummary>("/reports/order-summary"),
    refetchInterval: stale1m,
  });
  const orderSummary = orderQuery.data;

  const profitQuery = useQuery({
    queryKey: ["dashboard", "profit"],
    queryFn: () => safeGet<ProfitAnalysis>("/reports/profit-analysis"),
    refetchInterval: stale1m,
  });
  const profit = profitQuery.data;

  const costQuery = useQuery({
    queryKey: ["dashboard", "costReport"],
    queryFn: () => safeGet<ManufacturingCostReport>("/costing/report"),
    refetchInterval: stale1m,
  });
  const costReport = costQuery.data;

  const overdueQuery = useQuery({
    queryKey: ["dashboard", "overdueNotes"],
    queryFn: () => safeGet<number>("/notes/overdue-count"),
    refetchInterval: stale1m,
  });
  const overdueNotesCount = overdueQuery.data ?? 0;

  const riskQuery = useQuery({
    queryKey: ["dashboard", "stockoutRisk", riskLeadTime],
    queryFn: () => safeGet<StockoutRisk>("/reports/stockout-risk", { lead_time_days: riskLeadTime }),
    staleTime: stale1m,
  });
  const stockoutRisk = riskQuery.data;

  const trendsQuery = useQuery({
    queryKey: ["dashboard", "trends", trendDays],
    queryFn: () => safeGet<StockMovementTrends>("/reports/stock-movement-trends", { days: trendDays }),
    staleTime: stale1m,
  });
  const trends = trendsQuery.data;

  const topProductsQuery = useQuery({
    queryKey: ["dashboard", "topProducts", topProductsDays],
    queryFn: () => {
      const start = new Date(Date.now() - topProductsDays * 86_400_000).toISOString().slice(0, 10);
      return safeGet<SalesSummary>("/reports/sales-summary", { start_date: start });
    },
    staleTime: stale1m,
  });
  const salesSummary = topProductsQuery.data;

  const exportPdf = () => {
    api.get("/reports/dashboard/pdf", { params: { lead_time_days: riskLeadTime }, responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => {
      addToast("Failed to export dashboard PDF", "error");
    });
  };

  const reorderLowStock = async () => {
    const ids = stats?.low_stock_products.map((p) => p.id) ?? [];
    if (ids.length === 0) return;
    setReordering(true);
    try {
      const { data } = await api.post("/orders/reorder-low-stock", { product_ids: ids });
      addToast(`Created ${data.length} purchase order(s) for ${ids.length} low-stock item(s)`, "success");
      setConfirmReorder(false);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/orders");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to create purchase order"), "error");
    }
    setReordering(false);
  };

  if (statsQuery.isError && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">Failed to load dashboard data</div>
        <button onClick={() => statsQuery.refetch()} className="btn-primary text-sm">Retry</button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-muted -mt-3">A live overview of stock, sales, and warehouse health.</p>
        {[10, 6, 2, 3].map((count, i) => (
          <div key={i} className="space-y-3">
            <div className="h-4 w-20 bg-subtle-strong rounded animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Skeleton variant="card" rows={count} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const todayLocal = new Date();
  const localToday = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, "0")}-${String(todayLocal.getDate()).padStart(2, "0")}`;

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

  const inventoryCards: DashboardCard[] = [
    { label: "Active Products", value: stats.total_products, link: "/products" },
    {
      label: "Inventory Value",
      value: formatCurrency(stats.total_inventory_value, currencySymbol, 0),
      link: "/reports",
      minRole: "manager" as const,
    },
    { label: "Low Stock Items", value: stats.low_stock_count, link: "/products?low_stock=1", minRole: "manager" as const },
    { label: "Expiring Soon", value: stats.expiring_soon_count, link: "/products", minRole: "manager" as const },
    { label: "Quarantined Units", value: stats.quarantined_units ?? 0, link: "/exceptions", minRole: "manager" as const },
    { label: "Serial Numbers in Stock", value: stats.serial_numbers_in_stock ?? 0, link: "/serial-numbers", minRole: "manager" as const },
    { label: "Movements Today", value: stats.total_stock_movements_today, link: "/stock-movements", minRole: "manager" as const },
    { label: "LPNs", value: lpns?.total ?? 0, link: "/lpns", minRole: "manager" as const },
    { label: "Lots", value: stats.total_lots ?? 0, link: "/lots", minRole: "manager" as const },
    { label: "Receipts", value: receipts?.total ?? 0, link: "/receiving", minRole: "manager" as const },
  ];

  const fulfillmentCards: DashboardCard[] = [
    { label: "Open Shipments", value: stats.open_shipments ?? 0, link: "/shipments" },
    { label: "Pending Orders", value: pendingOrders, link: "/orders" },
    { label: "Pending ASNs", value: exceptions?.summary?.pending_asns ?? 0, link: "/asns", minRole: "manager" as const },
    { label: "Open Cycle Counts", value: exceptions?.summary?.open_cycle_counts ?? 0, link: "/cycle-counts", minRole: "manager" as const },
    {
      label: "Total Revenue",
      value: formatCurrency(salesStats?.total_revenue || 0, currencySymbol, 0),
      link: "/sales",
    },
    { label: "Overdue Notes", value: overdueNotesCount, link: "/notes", highlight: overdueNotesCount > 0 },
  ];

  const manufacturingCards: DashboardCard[] = [
    { label: "Open Work Orders", value: stats.open_work_orders ?? 0, link: "/work-orders", minRole: "manager" as const },
    { label: "Pending/Failed QC", value: stats.pending_quality_checks ?? 0, link: "/quality-checks", minRole: "manager" as const },
  ];

  const businessCards: DashboardCard[] = [
    { label: "Orders", value: stats.total_orders, link: "/orders", minRole: "manager" as const },
    { label: "Categories", value: stats.total_categories, minRole: "manager" as const },
    { label: "Suppliers", value: stats.total_suppliers, minRole: "manager" as const },
  ];

  const ROLE_RANK: Record<string, number> = { worker: 0, manager: 1, admin: 2 };
  const hasMinRole = (minRole?: string) => {
    if (!minRole || !user?.role) return true;
    return (ROLE_RANK[user.role] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
  };

  interface DashboardCard {
    label: string;
    value: string | number;
    link?: string;
    minRole?: string;
    highlight?: boolean;
  }

  const statSections = [
    { title: "Inventory", cards: inventoryCards, minRole: "manager" as const },
    { title: "Fulfillment", cards: fulfillmentCards },
    { title: "Manufacturing", cards: manufacturingCards, minRole: "manager" as const },
    { title: "Business", cards: businessCards, minRole: "manager" as const },
  ];

  const trendData = trends?.daily_trends || [];
  const riskSummary = stockoutRisk?.summary;
  const topProducts = salesSummary?.top_products?.slice(0, 5) || [];
  const topProfitProducts = profit?.products?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{isWorker ? `Welcome Back, ${greetingName}` : `Good to see you, ${greetingName}`}</h1>
          <p className="text-sm text-muted mt-1">A live overview of stock, sales, and warehouse health.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={exportPdf} className="btn-secondary inline-flex items-center gap-2" aria-label="Export dashboard PDF">
            pdf
          </button>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ["dashboard"] })} disabled={statsQuery.isFetching} className="btn-secondary" aria-label="Refresh dashboard">
            {statsQuery.isFetching ? "refreshing…" : "refresh"}
          </button>
        </div>
      </div>

      <GlobalSearch />

      {statsQuery.isError && stats && (
        <div role="alert" className="flex items-center justify-between bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          <span>Some dashboard data failed to load</span>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ["dashboard"] })} className="btn-secondary text-sm">Retry</button>
        </div>
      )}


      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions
            .filter((a) => canUser(user, a.permission))
            .map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(`${a.path}?new=1`)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:hover:border-indigo-400/60 transition-colors text-sm font-medium text-ink"
              >
                <a.icon size={18} className="text-indigo-600 dark:text-indigo-400" />
                {a.label}
              </button>
            ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Documents</h2>
        <AttachmentSection entityType="dashboard" entityId={0} canEdit={canUser(user, "dashboard.view")} />
      </div>

      {riskSummary && hasMinRole("manager") && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Stockout Risk</h2>
            <div className="flex rounded-lg border border-border overflow-hidden" aria-label="Stockout risk lead time">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setRiskLeadTime(d)}
                  className={`px-3 py-1 text-xs font-medium ${riskLeadTime === d ? "bg-indigo-600 text-white" : "text-muted hover:bg-app"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button onClick={() => navigate(`/reports?tab=stockout&lead_time_days=${riskLeadTime}`)} className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-500 text-left">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-red-500" size={16} />
              <p className="text-sm text-muted">High Stockout Risk</p>
            </div>
            <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{riskSummary.high}</p>
          </button>
          <button onClick={() => navigate(`/reports?tab=stockout&lead_time_days=${riskLeadTime}`)} className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-amber-400 text-left">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={16} />
              <p className="text-sm text-muted">Medium Stockout Risk</p>
            </div>
            <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{riskSummary.medium}</p>
          </button>
          <button onClick={() => navigate(`/reports?tab=stockout&lead_time_days=${riskLeadTime}`)} className="card cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-emerald-400 text-left">
            <p className="text-sm text-muted">Low Stockout Risk</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{riskSummary.low}</p>
          </button>
        </div>
        </div>
      )}

      {statSections.map((section) => {
        if (!hasMinRole(section.minRole)) return null;
        const visibleCards = section.cards.filter((c) => hasMinRole(c.minRole));
        if (visibleCards.length === 0) return null;
        return (
          <div key={section.title} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{section.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {visibleCards.map((card) => (
                <div
                  key={card.label}
                  onClick={() => card.link && navigate(card.link)}
                  className={`card ${card.link ? "cursor-pointer hover:shadow-md transition-shadow" : ""} ${card.highlight ? "border-l-4 border-l-red-500" : ""}`}
                >
                  <p className="text-sm text-muted">{card.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${card.highlight ? "text-red-600 dark:text-red-400" : ""}`}>{card.value}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {hasMinRole("manager") && (
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
        )}

        {hasMinRole("manager") && (
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
        )}

        {hasMinRole("manager") && (
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
        )}

        {hasMinRole("manager") && (
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
        )}

        {hasMinRole("manager") && (
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
                      <span className="text-muted">{formatDate(a.expected_arrival)}</span>
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
        )}

        {hasMinRole("manager") && (
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
        )}

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
                  <span className={`badge ${movementBadgeClass(m.movement_type)}`}>{movementLabel(m.movement_type)}</span>
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

        {hasMinRole("manager") && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Low Stock Alerts</h2>
            {canUser(user, "orders.create") && stats.low_stock_products.length > 0 && (
              <button onClick={() => setConfirmReorder(true)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                Create PO
              </button>
            )}
          </div>
          <div className="space-y-3">
            {stats.low_stock_products.length === 0 && (
              <p className="text-muted text-sm">All products are well-stocked</p>
            )}
            {stats.low_stock_products.map((p) => {
              const qty = p.sellable ?? p.quantity;
              const critical = qty <= 0 || qty <= p.reorder_level / 2;
              return (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted ml-2">({p.sku})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${critical ? "badge-danger" : "badge-warning"}`}>{critical ? "Critical" : "Low"}</span>
                    <span className="text-red-600 dark:text-red-400 font-medium">{qty}</span>
                    <span className="text-faint">/ {p.reorder_level}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {hasMinRole("manager") && (
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
                <span className={p.expiry_date < localToday ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-600 dark:text-amber-400 font-medium"}>
                  {formatDate(p.expiry_date)}
                </span>
              </div>
            ))}
          </div>
        </div>
        )}

        {hasMinRole("manager") && (
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
                    <span className="text-faint">{formatDate(r.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No receipts recorded yet</p>
          )}
        </div>
        )}

        {hasMinRole("manager") && (
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
        )}

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

        {hasMinRole("manager") && (
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
                    <ProgressBar value={s.total_picked} max={s.total_quantity} label={`Pick progress for ${s.shipment_number}`} />
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "packed" ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : s.status === "picking" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-subtle text-muted"}`}>
                      {s.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No shipments to process</p>
          )}
        </div>
        )}

        {hasMinRole("manager") && (
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
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">{w.status.replace("_", " ")}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No open work orders</p>
          )}
        </div>
        )}

        {hasMinRole("manager") && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Quality Checks to Process</h2>
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
                  <span className={`font-medium ${q.result === "pending" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{q.result}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm py-16 text-center">No pending or failed quality checks</p>
          )}
        </div>
        )}

        {hasMinRole("manager") && (
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
        )}
      </div>

      <ConfirmDialog
        open={confirmReorder}
        title="Create purchase orders for low stock?"
        message={`${stats.low_stock_products.length} low-stock item(s) will be reordered up to their reorder level:\n${stats.low_stock_products.map((p) => `• ${p.name} (${p.sellable ?? p.quantity}/${p.reorder_level})`).join("\n")}`}
        confirmLabel={reordering ? "Creating…" : "Create POs"}
        confirmClass="btn-primary"
        onConfirm={reorderLowStock}
        onCancel={() => setConfirmReorder(false)}
      />
    </div>
  );
}
