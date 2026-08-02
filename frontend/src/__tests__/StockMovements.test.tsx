import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import StockMovements from "../pages/StockMovements";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockMovement(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    product_id: 1,
    product_name: "Widget",
    user_id: 1,
    username: "tester",
    quantity_change: -3,
    movement_type: "out",
    reference: "INV-0001",
    notes: "Sold to customer",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    ...overrides,
  };
}

function mockMovements(items: ReturnType<typeof mockMovement>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/stock-movements") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("StockMovements Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders movement rows with product and type", async () => {
    mockMovements([mockMovement()]);
    renderWithProviders(<StockMovements />);
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("out")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("INV-0001")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockMovements([mockMovement()]);
    renderWithProviders(<StockMovements />);
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Movement" })).toBeInTheDocument();
    expect(screen.getByLabelText("Edit movement 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete movement 1")).toBeInTheDocument();
  });

  it("hides admin actions for workers", async () => {
    mockMovements([mockMovement()]);
    renderWithProviders(<StockMovements />, { role: "worker" });
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record Movement" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit movement 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete movement 1")).not.toBeInTheDocument();
  });

  it("shows empty state when no movements", async () => {
    mockMovements([]);
    renderWithProviders(<StockMovements />);
    expect(await screen.findByText("No movements recorded")).toBeInTheDocument();
  });
});
