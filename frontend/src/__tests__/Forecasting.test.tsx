import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import api from "../api/client";
import Forecasting from "../pages/Forecasting";
import { renderWithProviders } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

const row = {
  product_id: 1,
  product_name: "Widget",
  sku: "WID-001",
  supplier: "Acme Supplies",
  supplier_id: 1,
  on_hand: 5,
  reorder_level: 10,
  lead_time_days: 7,
  lead_time_source: "supplier",
  forecast: 2.5,
  baseline: 2.0,
  stddev: 1.2,
  safety_stock: 4,
  reorder_point: 22,
  open_orders: 0,
  suggested_order_qty: 17,
  days_of_cover: 2,
  status: "reorder",
};

const detail = {
  product_id: 1,
  product_name: "Widget",
  sku: "WID-001",
  supplier: "Acme Supplies",
  supplier_id: 1,
  service_level: 0.95,
  days: 90,
  forecast: 2.5,
  baseline: 2.0,
  factors: { 0: 1, 1: 1.1, 2: 0.9, 3: 1, 4: 1, 5: 1.2, 6: 0.8 },
  stddev: 1.2,
  lead_time_days: 7,
  lead_time_source: "supplier",
  safety_stock: 4,
  reorder_point: 22,
  on_hand: 5,
  open_orders: 0,
  suggested_order_qty: 17,
  daily: [{ date: "2026-08-01", quantity: 3 }],
  forecast_series: [{ date: "2026-08-08", forecast: 2.5 }],
};

function mockReplenishment() {
  getMock.mockImplementation((url: string) => {
    if (url === "/forecasting/replenishment") {
      return Promise.resolve({
        data: {
          items: [row],
          summary: { products: 1, to_reorder: 1, total_suggested_qty: 17, avg_lead_time: 7 },
          service_level: 0.95,
          days: 90,
        },
      });
    }
    if (url.startsWith("/forecasting/products/")) {
      return Promise.resolve({ data: detail });
    }
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Forecasting", () => {
  it("renders the replenishment table and summary", async () => {
    mockReplenishment();
    renderWithProviders(<Forecasting />);
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText(/WID-001/)).toBeInTheDocument();
    expect(screen.getByText(/Acme Supplies \(7d supplier\)/)).toBeInTheDocument();
    expect(screen.getByText("reorder")).toBeInTheDocument();
    expect(screen.getAllByText("17").length).toBeGreaterThan(0);
  });

  it("marks covered products as ok", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/forecasting/replenishment") {
        return Promise.resolve({
          data: {
            items: [{ ...row, product_id: 2, product_name: "Bolt", sku: "BOLT-1", suggested_order_qty: 0, status: "ok" }],
            summary: { products: 1, to_reorder: 0, total_suggested_qty: 0, avg_lead_time: 7 },
            service_level: 0.95,
            days: 90,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Forecasting />);
    expect(await screen.findByText("Bolt")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("shows an empty state when there are no products", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/forecasting/replenishment") {
        return Promise.resolve({
          data: { items: [], summary: { products: 0, to_reorder: 0, total_suggested_qty: 0, avg_lead_time: 0 }, service_level: 0.95, days: 90 },
        });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Forecasting />);
    expect(await screen.findByText("No products to analyze")).toBeInTheDocument();
  });

  it("opens the detail modal with the demand chart", async () => {
    mockReplenishment();
    renderWithProviders(<Forecasting />);
    const eye = await screen.findByLabelText("View forecast for Widget");
    fireEvent.click(eye);
    expect(await screen.findByText("Forecast: Widget")).toBeInTheDocument();
    expect(screen.getByText("Daily demand vs forecast")).toBeInTheDocument();
  });

  it("creates a purchase order via auto-reorder", async () => {
    mockReplenishment();
    postMock.mockResolvedValue({ data: { order_number: "PO-1001", items: [1] } });
    renderWithProviders(<Forecasting />);
    fireEvent.click(await screen.findByLabelText("Auto-reorder based on forecast"));
    fireEvent.click(screen.getByText("Generate PO"));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/orders/auto-reorder", null, expect.anything()));
    expect(await screen.findByText(/Reorder PO #PO-1001/)).toBeInTheDocument();
  });
});
