import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import SupplierPerformancePage from "../pages/SupplierPerformance";

const getMock = api.get as ReturnType<typeof vi.fn>;

const SAMPLE = {
  items: [
    {
      supplier_id: 1, name: "Acme", is_active: true,
      score: 92.5, rating: "excellent",
      on_time_rate: 100.0, quality_pass_rate: 100.0, lead_adherence: 80.0,
      total_orders: 4, total_spent: 400.0, avg_order_value: 100.0,
      open_orders: 1, last_order_at: "2026-09-01T00:00:00",
    },
    {
      supplier_id: 2, name: "No Metrics", is_active: true,
      score: null, rating: null,
      on_time_rate: null, quality_pass_rate: null, lead_adherence: null,
      total_orders: 0, total_spent: 0, avg_order_value: 0,
      open_orders: 0, last_order_at: null,
    },
  ],
  total: 2,
};

const DETAIL = {
  supplier_id: 1, name: "Acme", score: 92.5, rating: "excellent",
  on_time: { orders: 4, on_time: 4, late: 0, rate: 100.0, avg_deviation_days: -1.5 },
  lead_time: { promised_days: 14, actual_avg_days: 12.0, adherence: 100.0 },
  quality: { checks: 10, passed: 10, failed: 0, pass_rate: 100.0 },
  volume: { total_orders: 4, total_spent: 400.0, avg_order_value: 100.0, open_orders: 1, last_order_at: "2026-09-01T00:00:00" },
  price_trend: [{ month: "2026-01", avg_unit_price: 9.5, items: 2 }],
  recent_orders: [
    { order_id: 10, order_number: "PO-0010", created_at: "2026-08-20T00:00:00", expected_arrival: "2026-09-01T00:00:00", received_at: "2026-09-01T00:00:00", on_time: true },
  ],
};

function mockSuccess() {
  getMock.mockImplementation((url: string) => {
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
    if (url === "/suppliers/performance") return Promise.resolve({ data: SAMPLE });
    if (url === "/suppliers/1/performance") return Promise.resolve({ data: DETAIL });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("SupplierPerformancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders supplier rows", async () => {
    mockSuccess();
    renderWithProviders(<SupplierPerformancePage />);
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("92.5")).toBeInTheDocument();
    expect(screen.getByText("Excellent")).toBeInTheDocument();
    expect(screen.getByText("No Metrics")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("shows empty state when list is empty", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/suppliers/performance") return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.reject(new Error("Unexpected"));
    });
    renderWithProviders(<SupplierPerformancePage />);
    expect(await screen.findByText("No suppliers")).toBeInTheDocument();
  });

  it("opens detail panel when clicking a row", async () => {
    mockSuccess();
    renderWithProviders(<SupplierPerformancePage />);
    fireEvent.click(await screen.findByText("Acme"));
    expect(await screen.findByText("Recent Received Orders")).toBeInTheDocument();
    expect(screen.getByText("PO-0010")).toBeInTheDocument();
    expect(screen.getByText("On time")).toBeInTheDocument();
  });

  it("displays percentages for rate columns", async () => {
    mockSuccess();
    renderWithProviders(<SupplierPerformancePage />);
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getAllByText("100%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
});