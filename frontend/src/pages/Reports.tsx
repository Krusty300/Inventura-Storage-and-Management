import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import { useExportCsv } from "../hooks/useExportCsv";
import ReportSkeleton from "../components/ReportSkeleton";

const ValuationTab = lazy(() => import("./reports/ValuationTab"));
const MovementsTab = lazy(() => import("./reports/MovementsTab"));
const CategoriesTab = lazy(() => import("./reports/CategoriesTab"));
const ProfitTab = lazy(() => import("./reports/ProfitTab"));
const OrdersTab = lazy(() => import("./reports/OrdersTab"));
const SalesTab = lazy(() => import("./reports/SalesTab"));
const AgingTab = lazy(() => import("./reports/AgingTab"));
const StockoutTab = lazy(() => import("./reports/StockoutTab"));
const CustomersTab = lazy(() => import("./reports/CustomersTab"));
const SuppliersTab = lazy(() => import("./reports/SuppliersTab"));
const ManufacturingCostTab = lazy(() => import("./reports/ManufacturingCostTab"));
const RestaurantTab = lazy(() => import("./reports/RestaurantTab"));

const tabs = [
  { key: "valuation", label: "Valuation" },
  { key: "movements", label: "Movements" },
  { key: "categories", label: "Categories" },
  { key: "profit", label: "Profit" },
  { key: "orders", label: "Orders" },
  { key: "sales", label: "Sales" },
  { key: "restaurant", label: "Restaurant" },
  { key: "aging", label: "Aging" },
  { key: "stockout", label: "Stockout Risk" },
  { key: "customers", label: "Top Customers" },
  { key: "suppliers", label: "Top Suppliers" },
  { key: "manufacturing-cost", label: "Manufacturing Cost" },
] as const;
type Tab = (typeof tabs)[number]["key"];

export default function Reports() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<Tab>(tabs.some((t) => t.key === tabParam) ? (tabParam as Tab) : "valuation");
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { exportCsv } = useExportCsv();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <BarChart3 size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Reports &amp; Analytics</h1>
            <p className="text-sm text-muted mt-1">Sales, inventory, and valuation insights at a glance.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCsv("/reports/export/sales", "sales_report.csv")} className="btn-secondary text-sm py-1.5" aria-label="Export sales CSV">
            Export Sales
          </button>
          <button onClick={() => exportCsv("/reports/export/movements", "stock_movements_report.csv")} className="btn-secondary text-sm py-1.5" aria-label="Export movements CSV">
            Export Movements
          </button>
        </div>
      </div>

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

      <Suspense fallback={<ReportSkeleton stats={3} twoCharts />}>
        {activeTab === "valuation" && <ValuationTab symbol={currencySymbol} />}
        {activeTab === "movements" && <MovementsTab />}
        {activeTab === "categories" && <CategoriesTab symbol={currencySymbol} />}
        {activeTab === "profit" && <ProfitTab symbol={currencySymbol} />}
        {activeTab === "orders" && <OrdersTab symbol={currencySymbol} />}
        {activeTab === "sales" && <SalesTab symbol={currencySymbol} />}
        {activeTab === "aging" && <AgingTab />}
        {activeTab === "stockout" && <StockoutTab />}
        {activeTab === "customers" && <CustomersTab symbol={currencySymbol} />}
        {activeTab === "suppliers" && <SuppliersTab symbol={currencySymbol} />}
        {activeTab === "restaurant" && <RestaurantTab symbol={currencySymbol} />}
        {activeTab === "manufacturing-cost" && <ManufacturingCostTab symbol={currencySymbol} />}
      </Suspense>
    </div>
  );
}
