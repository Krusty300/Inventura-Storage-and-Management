import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, pickDate } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Reports from "../pages/Reports";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockReports() {
  getMock.mockImplementation((url: string) => {
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
    if (url === "/reports/inventory-valuation") return Promise.resolve({ data: { total_inventory_value: 1000, total_retail_value: 1500, potential_profit: 500, by_category: [], by_supplier: [] } });
    if (url === "/reports/stock-movement-trends") return Promise.resolve({ data: { labels: [], total_in: 0, total_out: 0, net_movement: 0 } });
    if (url === "/reports/category-breakdown") return Promise.resolve({ data: [{ id: 1, name: "Beverages", product_count: 3, total_stock: 10, total_cost_value: 50, total_retail_value: 80 }] });
    if (url === "/reports/profit-analysis") return Promise.resolve({ data: { total_cost_value: 0, total_potential_revenue: 0, total_potential_profit: 0, products: [] } });
    if (url === "/reports/order-summary") return Promise.resolve({ data: { total_orders: 0, pending: 0, completed: 0, total_order_value: 0, by_status: [], top_suppliers: [] } });
    if (url === "/reports/sales-summary") return Promise.resolve({ data: { total_sales: 0, total_revenue: 0, total_tax: 0, total_refunds: 0, by_payment_method: [], by_payment_provider: [], top_products: [] } });
    if (url === "/reports/payment-reconciliation") return Promise.resolve({ data: { rows: [], gross_total: 0, refunded_total: 0, net_total: 0, pending_refunds: 0 } });
    if (url === "/reports/top-customers") return Promise.resolve({ data: { items: [{ customer_id: 1, name: "Alice", phone: "555-0001", email: "alice@example.com", total_sales: 4, total_spent: 400, last_purchase_at: "2026-07-01T00:00:00" }], total: 1, days: null } });
    if (url === "/reports/top-suppliers") return Promise.resolve({ data: { items: [{ supplier_id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", total_orders: 3, total_spent: 300, last_order_at: "2026-07-01T00:00:00" }], total: 1, days: null } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Reports Page", () => {
  vi.setConfig({ testTimeout: 60000 });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders valuation stat cards", async () => {
    mockReports();
    renderWithProviders(<Reports />);
    await waitFor(() => {
      expect(screen.getByText("Inventory Value (Cost)")).toBeInTheDocument();
    }, { timeout: 45000 });
    expect(screen.getByText("Retail Value")).toBeInTheDocument();
    expect(screen.getByText("Potential Profit")).toBeInTheDocument();
  });

  it("switches tabs and renders category breakdown", async () => {
    mockReports();
    renderWithProviders(<Reports />);
    fireEvent.click(await screen.findByRole("button", { name: "Categories" }));
    expect(await screen.findByText("Beverages", {}, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("shows a warning in Sales tab when the date range is invalid", async () => {
    mockReports();
    renderWithProviders(<Reports />);
    fireEvent.click(await screen.findByRole("button", { name: "Sales" }));
    await screen.findByLabelText("Start date", {}, { timeout: 15000 });
    pickDate("Start date", "2026-02-01");
    pickDate("End date", "2026-01-01");
    expect(await screen.findByRole("alert")).toHaveTextContent("Start date must be before end date");
  });

  it("renders the top customers tab with spending data", async () => {
    mockReports();
    renderWithProviders(<Reports />);
    fireEvent.click(await screen.findByRole("button", { name: "Top Customers" }));
    expect(await screen.findByText("555-0001", {}, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getAllByText("$400.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Period" })).toBeInTheDocument();
  });

  it("renders the top suppliers tab with spending data", async () => {
    mockReports();
    renderWithProviders(<Reports />);
    fireEvent.click(await screen.findByRole("button", { name: "Top Suppliers" }));
    expect((await screen.findAllByText("Acme Supplies", {}, { timeout: 15000 })).length).toBeGreaterThan(0);
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getAllByText("$300.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Period" })).toBeInTheDocument();
  });

  it("renders the sales tab with payment method totals and reconciliation", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/reports/inventory-valuation") return Promise.resolve({ data: { total_inventory_value: 0, total_retail_value: 0, potential_profit: 0, by_category: [], by_supplier: [] } });
      if (url === "/reports/stock-movement-trends") return Promise.resolve({ data: { labels: [], total_in: 0, total_out: 0, net_movement: 0 } });
      if (url === "/reports/category-breakdown") return Promise.resolve({ data: [] });
      if (url === "/reports/profit-analysis") return Promise.resolve({ data: { total_cost_value: 0, total_potential_revenue: 0, total_potential_profit: 0, products: [] } });
      if (url === "/reports/order-summary") return Promise.resolve({ data: { total_orders: 0, pending: 0, completed: 0, total_order_value: 0, by_status: [], top_suppliers: [] } });
      if (url === "/reports/sales-summary") return Promise.resolve({ data: { total_sales: 2, total_revenue: 200, total_tax: 0, total_refunds: 1, by_payment_method: [{ method: "mobile_money", count: 2, total: 200 }], by_payment_provider: [{ provider: "m-pesa", count: 2, total: 200 }], top_products: [] } });
      if (url === "/reports/payment-reconciliation") return Promise.resolve({ data: { rows: [{ method: "mobile_money", provider: "m-pesa", count: 2, gross_total: 200, refunded_total: 100, net_total: 100, pending_refunds: 1, completed_refunds: 0, refunded_count: 1 }], gross_total: 200, refunded_total: 100, net_total: 100, pending_refunds: 1 } });
      if (url === "/reports/top-customers") return Promise.resolve({ data: { items: [], total: 0, days: null } });
      if (url === "/reports/top-suppliers") return Promise.resolve({ data: { items: [], total: 0, days: null } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Reports />);
    fireEvent.click(await screen.findByRole("button", { name: "Sales" }));
    expect((await screen.findAllByText("Mobile Money", {}, { timeout: 15000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/M-Pesa/).length).toBeGreaterThan(0);
    expect(screen.getByText("Payment Reconciliation")).toBeInTheDocument();
    expect(screen.getAllByText("$200.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$100.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending refunds")).toBeInTheDocument();
  });
});
