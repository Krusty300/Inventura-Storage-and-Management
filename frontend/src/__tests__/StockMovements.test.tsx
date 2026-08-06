import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
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

  it("allows workers to record but not edit or delete movements", async () => {
    mockMovements([mockMovement()]);
    renderWithProviders(<StockMovements />, { role: "worker" });
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Movement" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit movement 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete movement 1")).not.toBeInTheDocument();
  });

  it("shows empty state when no movements", async () => {
    mockMovements([]);
    renderWithProviders(<StockMovements />);
    expect(await screen.findByText("No movements recorded")).toBeInTheDocument();
  });

  it("shows route and pair for transfer movements and hides edit", async () => {
    mockMovements([mockMovement({
      id: 5,
      quantity_change: -2,
      movement_type: "transfer_out",
      from_location_name: "Bin A",
      to_location_name: "Bin B",
      transfer_id: 6,
    })]);
    renderWithProviders(<StockMovements />);
    expect(await screen.findByText("Bin A")).toBeInTheDocument();
    expect(screen.getByText("Bin B")).toBeInTheDocument();
    expect(screen.getByText("paired #6")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit movement 5")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Delete movement 5")).toBeInTheDocument();
  });

  it("shows the source location in the route for a scrap movement", async () => {
    mockMovements([mockMovement({
      id: 7,
      quantity_change: -1,
      movement_type: "scrap",
      from_location_name: "Bin C",
      to_location_name: "",
      reference: "Cycle count CC-0001",
    })]);
    renderWithProviders(<StockMovements />);
    expect(await screen.findByText("Bin C")).toBeInTheDocument();
  });

  it("shows route in the detail modal for a scrap movement", async () => {
    mockMovements([mockMovement({
      id: 8,
      quantity_change: -1,
      movement_type: "scrap",
      from_location_name: "Bin C",
      to_location_name: "",
      reference: "Cycle count CC-0001",
    })]);
    renderWithProviders(<StockMovements />);
    const viewButton = await screen.findByLabelText("View movement 8");
    viewButton.click();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Route:")).toBeInTheDocument();
    expect(within(dialog).getByText("Bin C")).toBeInTheDocument();
  });
});
