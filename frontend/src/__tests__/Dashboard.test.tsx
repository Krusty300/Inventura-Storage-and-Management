import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
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
  total_lots: 3,
  low_stock_count: 1,
  expiring_soon_count: 2,
  total_inventory_value: 2500,
  total_stock_movements_today: 7,
  open_shipments: 2,
  open_work_orders: 1,
  pending_quality_checks: 3,
  quarantined_units: 4,
  serial_numbers_in_stock: 5,
  recent_movements: [
    { id: 1, product_name: "Widget", quantity_change: -2, movement_type: "out", created_at: "2026-01-01T10:00:00" },
  ],
  low_stock_products: [{ id: 1, name: "Gadget", sku: "SKU-1", quantity: 2, reorder_level: 10 }],
  expiring_products: [],
  shipments_to_process: [],
  work_orders_to_process: [],
  quality_checks_to_process: [],
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
const emptyCostReport = { items: [], total_material_cost: 0, total_standard_cost: 0, total_variance: 0, completed_orders: 0 };

const searchResults = {
  query: "widget",
  total: 3,
  results: [
    { type: "product", id: 1, label: "Widget", subtitle: "SKU-001 · 12 in stock", route: "/products" },
    { type: "lot", id: 1, label: "LOT-001", subtitle: "Widget · Warehouse A", route: "/lots" },
    { type: "customer", id: 1, label: "Widget Co", subtitle: "widgetco@example.com", route: "/customers" },
  ],
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function mockDashboard(overrides: { stats?: Record<string, unknown>; exceptions?: Record<string, unknown>; lpns?: Record<string, unknown>; receipts?: Record<string, unknown>; salesSummary?: Record<string, unknown>; search?: Record<string, unknown> } = {}) {
  const statsData = overrides.stats ? { ...stats, ...overrides.stats } : stats;
  const exceptionsData = overrides.exceptions ? { ...emptyExceptions, ...overrides.exceptions } : emptyExceptions;
  const lpnsData = overrides.lpns ? { ...emptyPage, ...overrides.lpns } : emptyPage;
  const receiptsData = overrides.receipts ? { ...emptyPage, ...overrides.receipts } : emptyPage;
  const salesSummaryData = overrides.salesSummary ? { ...emptySalesSummary, ...overrides.salesSummary } : emptySalesSummary;

  getMock.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
    if (url === "/search") {
      const q = config?.params?.q ?? "";
      if (q === "widget") return Promise.resolve({ data: searchResults });
      return Promise.resolve({ data: { query: q, total: 0, results: [] } });
    }
    if (url === "/dashboard/stats") return Promise.resolve({ data: statsData });
    if (url === "/sales/stats") return Promise.resolve({ data: { total_sales: 5, total_revenue: 1200, recent_sales: [] } });
    if (url.startsWith("/reports/stock-movement-trends")) return Promise.resolve({ data: emptyTrends });
    if (url === "/reports/inventory-valuation") return Promise.resolve({ data: emptyValuation });
    if (url === "/reports/exceptions") return Promise.resolve({ data: exceptionsData });
    if (url === "/reports/stockout-risk") return Promise.resolve({ data: emptyRisk });
    if (url === "/lpns") return Promise.resolve({ data: lpnsData });
    if (url === "/receipts") return Promise.resolve({ data: receiptsData });
    if (url === "/reports/order-summary") return Promise.resolve({ data: emptyOrderSummary });
    if (url === "/reports/category-breakdown") return Promise.resolve({ data: [] });
    if (url === "/reports/profit-analysis") return Promise.resolve({ data: emptyProfit });
    if (url === "/costing/report") return Promise.resolve({ data: emptyCostReport });
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
    expect(await screen.findByText("Active Products")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("$2,500")).toBeInTheDocument();
    expect(screen.getByText("$1,200")).toBeInTheDocument();
  });

  it("shows the Lots card and navigates to the lots page", async () => {
    mockDashboard();
    renderWithProviders(
      <>
        <Dashboard />
        <LocationProbe />
      </>
    );
    expect(await screen.findByText("Lots")).toBeInTheDocument();
    const card = screen.getByText("Lots").closest(".card") as HTMLElement;
    expect(within(card).getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Lots"));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/lots");
    });
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

  it("renders the new operational panels from exceptions, lpns and receipts", async () => {    mockDashboard({
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
    expect(await screen.findByText("ASN-100")).toBeInTheDocument();
    expect(await screen.findByText("CC-200")).toBeInTheDocument();
    expect(await screen.findByText("LPN-01")).toBeInTheDocument();
    expect(await screen.findByText("RCPT-1")).toBeInTheDocument();
    expect(await screen.findByText("BestSeller")).toBeInTheDocument();
  });

  it("shows empty low stock and no-movement messages when there is no data", async () => {
    mockDashboard({ stats: { recent_movements: [], low_stock_products: [], expiring_products: [] } });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("No recent movements")).toBeInTheDocument();
    expect(screen.getByText("All products are well-stocked")).toBeInTheDocument();
    expect(screen.getByText("No sales recorded yet")).toBeInTheDocument();
  });

  it("renders fulfillment, manufacturing and quality panels from dashboard stats", async () => {
    mockDashboard({
      stats: {
        shipments_to_process: [{ id: 1, shipment_number: "SHP-200", customer_name: "Acme", status: "packed", total_quantity: 10, total_picked: 10, total_amount: 150, created_at: "2026-01-01T00:00:00" }],
        work_orders_to_process: [{ id: 1, wo_number: "WO-300", product_name: "Gadget", status: "released", quantity: 5, created_at: "2026-01-01T00:00:00" }],
        quality_checks_to_process: [{ id: 1, qc_number: "QC-400", product_name: "Gadget", result: "pending", created_at: "2026-01-01T00:00:00" }],
      },
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Shipments to Process")).toBeInTheDocument();
    expect(screen.getByText("SHP-200")).toBeInTheDocument();
    expect(screen.getByText("WO-300")).toBeInTheDocument();
    expect(screen.getByText("QC-400")).toBeInTheDocument();
    expect(screen.getByText("Manufacturing Cost")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Record Receipt" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "New ASN" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "New Order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Sale" })).toBeInTheDocument();
  });

  it("quick actions deep-link with ?new=1 to open create forms directly", async () => {
    mockDashboard();
    renderWithProviders(
      <>
        <Dashboard />
        <LocationProbe />
      </>
    );
    await screen.findByText("Quick Actions");
    fireEvent.click(screen.getByRole("button", { name: "New ASN" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/asns?new=1");
    });
  });

  it("shows error state with retry when the API fails", async () => {
    getMock.mockRejectedValue(new Error("boom"));
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Failed to load dashboard data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("global search queries /search and shows grouped results", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);
    await screen.findByText("Active Products");
    const input = screen.getByLabelText("Global search");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "widget" } });
    expect(await screen.findByText("LOT-001", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Widget Co")).toBeInTheDocument();
    expect(screen.getByText("Customers (1)")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/search", { params: { q: "widget" } });
  });

  it("global search navigates to the result page with a search prefill", async () => {
    mockDashboard();
    renderWithProviders(
      <>
        <Dashboard />
        <LocationProbe />
      </>
    );
    await screen.findByText("Active Products");
    const input = screen.getByLabelText("Global search");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "widget" } });
    const result = await screen.findByRole("button", { name: /SKU-001/ }, { timeout: 5000 });
    fireEvent.click(result);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/products?search=Widget");
    }, { timeout: 5000 });
    expect(screen.getByLabelText("Global search")).toHaveValue("");
  });

  it("does not query the global search endpoint for queries shorter than 2 characters", async () => {
    mockDashboard();
    renderWithProviders(<Dashboard />);
    await screen.findByText("Active Products");
    const input = screen.getByLabelText("Global search");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(getMock).not.toHaveBeenCalledWith("/search", expect.anything());
  });

  it("passes lead_time_days to stockout risk and deep-links to the stockout report", async () => {
    mockDashboard();
    renderWithProviders(
      <>
        <Dashboard />
        <LocationProbe />
      </>
    );
    await screen.findByText("Active Products");
    expect(getMock).toHaveBeenCalledWith("/reports/stockout-risk", { params: { lead_time_days: 7 } });
    const leadGroup = await screen.findByLabelText("Stockout risk lead time");
    fireEvent.click(within(leadGroup).getByRole("button", { name: "30d" }));
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/reports/stockout-risk", { params: { lead_time_days: 30 } });
    });
    expect(await screen.findByRole("button", { name: /High Stockout Risk/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /High Stockout Risk/ }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/reports?tab=stockout&lead_time_days=30");
    });
  });
});
