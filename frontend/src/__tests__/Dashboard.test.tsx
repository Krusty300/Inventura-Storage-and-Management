import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Dashboard from "../pages/Dashboard";

const getMock = api.get as ReturnType<typeof vi.fn>;

const stats = {
  total_products: 12,
  total_categories: 3,
  total_suppliers: 2,
  total_orders: 5,
  low_stock_count: 1,
  expiring_soon_count: 2,
  total_inventory_value: 2500,
  total_stock_movements_today: 7,
  recent_movements: [
    { id: 1, product_name: "Widget", quantity_change: -2, movement_type: "out", created_at: "2026-01-01T10:00:00" },
  ],
  low_stock_products: [{ id: 1, name: "Gadget", sku: "SKU-1", quantity: 2, reorder_level: 10 }],
  expiring_products: [],
};

const emptyTrends = { total_in: 0, total_out: 0, net_movement: 0, daily_trends: [] };
const emptyValuation = { total_inventory_value: 0, total_retail_value: 0, potential_profit: 0, by_category: [], by_supplier: [] };
const emptyExceptions = {
  summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 0, open_cycle_counts: 0, pending_asns: 0 },
  low_stock: [], zero_stock: [], quarantined_lots: [], open_cycle_counts: [], pending_asns: [],
};
const emptyRisk = { items: [], summary: { high: 0, medium: 0, low: 0 } };
const emptyPage = { items: [], total: 0, page: 1, pages: 1 };
const emptyOrderSummary = { total_orders: 0, total_order_value: 0, by_status: [], top_suppliers: [] };
const emptyProfit = { total_cost_value: 0, total_potential_revenue: 0, total_potential_profit: 0, product_count: 0, products: [] };
const emptySalesSummary = { total_sales: 0, total_refunds: 0, total_revenue: 0, total_tax: 0, by_payment_method: [], top_products: [] };

function mockDashboard(overrides: { stats?: Record<string, unknown>; exceptions?: Record<string, unknown>; lpns?: Record<string, unknown>; receipts?: Record<string, unknown>; salesSummary?: Record<string, unknown> } = {}) {
  const statsData = overrides.stats ? { ...stats, ...overrides.stats } : stats;
  const exceptionsData = overrides.exceptions ? { ...emptyExceptions, ...overrides.exceptions } : emptyExceptions;
  const lpnsData = overrides.lpns ? { ...emptyPage, ...overrides.lpns } : emptyPage;
  const receiptsData = overrides.receipts ? { ...emptyPage, ...overrides.receipts } : emptyPage;
  const salesSummaryData = overrides.salesSummary ? { ...emptySalesSummary, ...overrides.salesSummary } : emptySalesSummary;

  getMock.mockImplementation((url: string) => {
    if (url === "/dashboard/stats") return Promise.resolve({ data: statsData });
    if (url === "/sales/stats") return Promise.resolve({ data: { total_sales: 5, total_revenue: 1200, recent_sales: [] } });
    if (url.startsWith("/reports/stock-movement-trends")) return Promise.resolve({ data: emptyTrends });
    if (url === "/reports/inventory-valuation") return Promise.resolve({ data: emptyValuation });
    if (url === "/reports/exceptions") return Promise.resolve({ data: exceptionsData });
    if (url === "/reports/stockout-risk") return Promise.resolve({ data: emptyRisk });
    if (url === "/lpns?limit=20") return Promise.resolve({ data: lpnsData });
    if (url === "/receipts?limit=20") return Promise.resolve({ data: receiptsData });
    if (url === "/reports/order-summary") return Promise.resolve({ data: emptyOrderSummary });
    if (url === "/reports/category-breakdown") return Promise.resolve({ data: [] });
    if (url === "/reports/profit-analysis") return Promise.resolve({ data: emptyProfit });
    if (url.startsWith("/reports/sales-summary")) return Promise.resolve({ data: salesSummaryData });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Dashboard Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders stat cards from the API", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Total Products")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("$2,500")).toBeInTheDocument();
    expect(screen.getByText("$1,200")).toBeInTheDocument();
  });

  it("renders recent movements and low stock alerts", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Recent Stock Movements")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    expect(screen.getByText("Low Stock Alerts")).toBeInTheDocument();
    expect(screen.getByText(/(SKU-1)/)).toBeInTheDocument();
  });

  it("renders the new operational panels from exceptions, lpns and receipts", async () => {
    mockDashboard({
      exceptions: {
        summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 0, open_cycle_counts: 1, pending_asns: 1 },
        pending_asns: [{ id: 1, asn_number: "ASN-100", supplier: "Acme", expected_arrival: "2026-01-15", items_pending: 40, created_at: "2026-01-01T00:00:00" }],
        open_cycle_counts: [{ id: 1, cc_number: "CC-200", status: "in_progress", location: "A1", has_variance: true, total_expected: 20, total_variance: 3, created_at: "2026-01-01T00:00:00" }],
      },
      lpns: { items: [{ id: 1, lpn_number: "LPN-01", lpn_type: "pallet", location_id: 1, status: "active", created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00", location_name: "A1", content_count: 1, total_quantity: 25, contents: [] }], total: 1, page: 1, pages: 1 },
      receipts: { items: [{ id: 1, receipt_number: "RCPT-1", supplier_id: 1, user_id: 1, reference: "", notes: "", total_quantity: 50, total_cost: 200, created_at: "2026-01-01T00:00:00", supplier_name: "Acme", username: "tester", items: [] }], total: 1, page: 1, pages: 1 },
      salesSummary: { total_sales: 3, total_refunds: 0, total_revenue: 600, total_tax: 0, by_payment_method: [], top_products: [{ name: "BestSeller", quantity_sold: 10, revenue: 250 }] },
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findAllByText("Pending ASNs")).toHaveLength(2);
    expect(screen.getByText("ASN-100")).toBeInTheDocument();
    expect(screen.getByText("CC-200")).toBeInTheDocument();
    expect(screen.getByText("LPN-01")).toBeInTheDocument();
    expect(screen.getByText("RCPT-1")).toBeInTheDocument();
    expect(screen.getByText("BestSeller")).toBeInTheDocument();
  });

  it("shows empty low stock and no-movement messages when there is no data", async () => {
    mockDashboard({ stats: { recent_movements: [], low_stock_products: [], expiring_products: [] } });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("No recent movements")).toBeInTheDocument();
    expect(screen.getByText("All products are well-stocked")).toBeInTheDocument();
    expect(screen.getByText("No sales recorded yet")).toBeInTheDocument();
  });

  it("shows all quick actions for admin", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Quick Actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Receipt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New ASN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Sale" })).toBeInTheDocument();
  });

  it("gates quick actions for workers to allowed permissions", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />, { role: "worker" });
    expect(await screen.findByText("Quick Actions")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Record Receipt" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "New ASN" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Sale" })).toBeInTheDocument();
  });

  it("shows error state with retry when the API fails", async () => {
    getMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<Dashboard />);
    expect(await screen.findAllByText("Failed to load dashboard data")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
