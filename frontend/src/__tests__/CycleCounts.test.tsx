import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import CycleCounts from "../pages/CycleCounts";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockCycleCount(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    cc_number: "CC-0001",
    location_id: 1,
    created_by: 1,
    status: "in_progress",
    notes: "",
    created_at: "2026-01-01T10:00:00",
    completed_at: null,
    location_name: "Warehouse A",
    username: "tester",
    has_variance: false,
    total_expected: 15,
    total_variance: -2,
    items: [
      {
        id: 1,
        cycle_count_id: 1,
        product_id: 1,
        expected_qty: 15,
        counted_qty: null,
        variance: -2,
        status: "pending",
        product_name: "Widget",
      },
    ],
    ...overrides,
  };
}

function mockCounts(items: ReturnType<typeof mockCycleCount>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/cycle-counts") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (url === "/products")
      return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, variants: [] }], total: 1, page: 1, pages: 1 } });
    if (url === "/locations") return Promise.resolve({ data: { items: [] } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("CycleCounts Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders cycle count rows with location and variance", async () => {
    mockCounts([mockCycleCount()]);
    renderWithProviders(<CycleCounts />);
    expect(await screen.findByText("CC-0001")).toBeInTheDocument();
    expect(screen.getByText("Warehouse A")).toBeInTheDocument();
    expect(screen.getByText("in_progress")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockCounts([mockCycleCount()]);
    renderWithProviders(<CycleCounts />);
    expect(await screen.findByText("CC-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Count" })).toBeInTheDocument();
    expect(screen.getByLabelText("View CC-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Count CC-0001")).toBeInTheDocument();
  });

  it("hides admin actions for workers", async () => {
    mockCounts([mockCycleCount()]);
    renderWithProviders(<CycleCounts />, { role: "worker" });
    expect(await screen.findByText("CC-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("View CC-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Count" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Count CC-0001")).not.toBeInTheDocument();
  });

  it("shows empty state when no cycle counts", async () => {
    mockCounts([]);
    renderWithProviders(<CycleCounts />);
    expect(await screen.findByText("No cycle counts yet")).toBeInTheDocument();
  });

  it("opens the new count form with selectable products", async () => {
    mockCounts([mockCycleCount()]);
    renderWithProviders(<CycleCounts />);
    fireEvent.click(await screen.findByRole("button", { name: "New Count" }));
    expect(await screen.findByRole("option", { name: "Widget (SKU-1)" })).toBeInTheDocument();
  });
});
