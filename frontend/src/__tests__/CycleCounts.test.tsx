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

function mockCounts(
  items: ReturnType<typeof mockCycleCount>[],
  location: { locations?: Array<Record<string, unknown>>; stockLines?: Array<Record<string, unknown>>; serials?: Array<Record<string, unknown>> } = {}
) {
  getMock.mockImplementation((url: string) => {
    if (url === "/cycle-counts") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (url === "/products")
      return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, variants: [] }], total: 1, page: 1, pages: 1 } });
    if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 1, name: "Warehouse A", path: "Warehouse A", is_active: true }, ...(location.locations || [])] } });
    if (url === "/locations/1/detail") return Promise.resolve({ data: { stock_lines: location.stockLines || [], serials: location.serials || [] } });
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

  it("shows counting actions for workers", async () => {
    mockCounts([mockCycleCount()]);
    renderWithProviders(<CycleCounts />, { role: "worker" });
    expect(await screen.findByText("CC-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("View CC-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Count" })).toBeInTheDocument();
    expect(screen.getByLabelText("Count CC-0001")).toBeInTheDocument();
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

  it("limits product options to products stocked at the selected location", async () => {
    mockCounts([mockCycleCount()], {
      stockLines: [
        { id: 1, product_id: 1, product_name: "Widget", sku: "SKU-1", lot_number: "", lpn_number: "", quantity: 5, unit_cost: 10, value: 50 },
        { id: 2, product_id: 2, product_name: "Gadget", sku: "SKU-2", lot_number: "", lpn_number: "", quantity: 3, unit_cost: 20, value: 60 },
      ],
    });
    renderWithProviders(<CycleCounts />);
    fireEvent.click(await screen.findByRole("button", { name: "New Count" }));
    await screen.findByRole("option", { name: "Warehouse A" });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "1" } });
    expect(await screen.findByRole("option", { name: "Gadget (SKU-2)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Widget (SKU-1)" })).toBeInTheDocument();
  });

  it("includes serialized products from the selected location", async () => {
    mockCounts([mockCycleCount()], {
      stockLines: [
        { id: 1, product_id: 1, product_name: "Widget", sku: "SKU-1", lot_number: "", lpn_number: "", quantity: 5, unit_cost: 10, value: 50 },
      ],
      serials: [
        { id: 1, product_id: 3, product_name: "Asset", sku: "SKU-3", serial_number: "SN-1", lot_number: "", status: "in_stock", unit_cost: 25, value: 25 },
      ],
    });
    renderWithProviders(<CycleCounts />);
    fireEvent.click(await screen.findByRole("button", { name: "New Count" }));
    await screen.findByRole("option", { name: "Warehouse A" });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "1" } });
    expect(await screen.findByRole("option", { name: "Asset (SKU-3) (Serialized)" })).toBeInTheDocument();
  });
});
