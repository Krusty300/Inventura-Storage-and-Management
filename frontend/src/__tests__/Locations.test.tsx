import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Locations from "../pages/Locations";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockLocationTree(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "A-01",
    name: "Aisle A",
    path: "Aisle A",
    parent_id: null,
    location_type: "aisle",
    is_active: true,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    stock_line_count: 3,
    lpn_count: 1,
    lot_count: 1,
    total_quantity: 120,
    stock_value: 480.5,
    children: [],
    ...overrides,
  };
}

function mockLocations(tree: ReturnType<typeof mockLocationTree>[], summary: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) {
  getMock.mockImplementation((url: string) => {
    if (url === "/locations/tree") return Promise.resolve({ data: tree });
    if (url === "/locations") return Promise.resolve({ data: { items: tree, total: tree.length, page: 1, pages: 1 } });
    if (url === "/locations/summary") {
      return Promise.resolve({
        data: { total: 3, active: 3, inactive: 0, total_stock_lines: 5, total_lpns: 2, total_lots: 1, total_quantity: 40, total_value: 100, ...summary },
      });
    }
    if (url.startsWith("/locations/") && url.endsWith("/detail")) {
      const id = Number(url.split("/")[2]);
      const loc = tree.find((t) => t.id === id);
      return Promise.resolve({
        data: {
          location: loc ?? mockLocationTree({ id }),
          stock_lines: [{ id: 1, product_id: 1, product_name: "Widget", sku: "SKU-1", lot_number: "", lpn_number: "", quantity: 4, unit_cost: 5, value: 20 }],
          lpns: [{ id: 1, lpn_number: "LPN-1", lpn_type: "pallet", status: "active", total_quantity: 4 }],
          ...detail,
        },
      });
    }
    if (url === "/activity-logs") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
    if (url === "/reports/export/locations") return Promise.resolve({ data: new Blob(["a,b,c"], { type: "text/csv" }) });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Locations Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders location tree rows with counts", async () => {
    mockLocations([mockLocationTree({ children: [mockLocationTree({ id: 2, code: "A-01-01", name: "Bin A-01", path: "Bin A-01", parent_id: 1, location_type: "bin", stock_line_count: 5, lpn_count: 2, total_quantity: 40, stock_value: 60, children: [] })] })]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    expect(screen.getByText("Aisle")).toBeInTheDocument();
    expect(screen.getByText("3 lines")).toBeInTheDocument();
    expect(screen.getByText("120 units")).toBeInTheDocument();
    expect(screen.getByText("1 lots")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findByText("Bin A-01")).toBeInTheDocument();
    expect(screen.getByText("5 lines")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Location" })).toBeInTheDocument();
    expect(screen.getByLabelText("Edit Aisle A")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete Aisle A")).toBeInTheDocument();
    expect(screen.getByLabelText("View Aisle A")).toBeInTheDocument();
  });

  it("hides admin actions for workers", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />, { role: "worker" });
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Location" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit Aisle A")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete Aisle A")).not.toBeInTheDocument();
  });

  it("expands and collapses tree nodes", async () => {
    mockLocations([mockLocationTree({ children: [mockLocationTree({ id: 2, code: "A-01-01", name: "Bin A-01", path: "Bin A-01", parent_id: 1, location_type: "bin", children: [] })] })]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    expect(screen.queryByText("Bin A-01")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findByText("Bin A-01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Bin A-01")).not.toBeInTheDocument();
  });

  it("shows empty state when no locations", async () => {
    mockLocations([]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("No locations yet")).toBeInTheDocument();
  });

  it("shows summary cards", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("$100")).toBeInTheDocument();
    expect(screen.getByText("Total Locations")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Lots")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("filters the tree by search and reveals matching descendants", async () => {
    mockLocations([
      mockLocationTree({
        children: [
          mockLocationTree({ id: 2, code: "A-01-01", name: "Bin A-01", path: "Aisle A / Bin A-01", parent_id: 1, location_type: "bin", children: [] }),
          mockLocationTree({ id: 3, code: "A-01-02", name: "Shelf 1", path: "Aisle A / Shelf 1", parent_id: 1, location_type: "shelf", children: [] }),
        ],
      }),
    ]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search locations"), { target: { value: "bin" } });
    expect(await screen.findByText("Aisle A / Bin A-01")).toBeInTheDocument();
    expect(screen.queryByText("Aisle A / Shelf 1")).not.toBeInTheDocument();
  });

  it("shows an empty search state when nothing matches", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search locations"), { target: { value: "zzz" } });
    expect(await screen.findByText("No matching locations")).toBeInTheDocument();
  });

  it("expands and collapses all locations", async () => {
    mockLocations([mockLocationTree({ children: [mockLocationTree({ id: 2, code: "A-01-01", name: "Bin A-01", path: "Bin A-01", parent_id: 1, location_type: "bin", children: [] })] })]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    expect(screen.queryByText("Bin A-01")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand all locations" }));
    expect(await screen.findByText("Bin A-01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all locations" }));
    expect(screen.queryByText("Bin A-01")).not.toBeInTheDocument();
  });

  it("opens the detail modal with stock and LPNs", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("View Aisle A"));
    expect(await screen.findByText("Stock (1)")).toBeInTheDocument();
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /LPNs \(1\)/ }));
    expect(await screen.findByText("LPN-1")).toBeInTheDocument();
  });

  it("shows scrapped serials in the detail modal", async () => {
    mockLocations([mockLocationTree()], {}, {
      scrapped_serials: [
        { id: 2, product_id: 1, product_name: "Widget", sku: "SKU-1", serial_number: "W-002", lot_number: "", status: "scrapped", unit_cost: 5, value: 5 },
        { id: 3, product_id: 1, product_name: "Widget", sku: "SKU-1", serial_number: "W-003", lot_number: "", status: "scrapped", unit_cost: 5, value: 5 },
      ],
    });
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByLabelText("View Aisle A"));
    expect(await screen.findByText("Scrapped serials (2)")).toBeInTheDocument();
    expect(screen.getByText("W-002")).toBeInTheDocument();
    expect(screen.getByText("W-003")).toBeInTheDocument();
    expect(screen.getAllByText("scrapped")).toHaveLength(2);
  });

  it("shows stock movements in the detail modal activity tab", async () => {
    mockLocations([mockLocationTree()], {}, {
      movements: [
        { id: 1, product_name: "Widget", quantity_change: 4, movement_type: "in", username: "tester", from_location: "", to_location: "Aisle A", lot_number: "LOT-1", created_at: "2026-01-01T10:00:00" },
        { id: 2, product_name: "Gadget", quantity_change: -2, movement_type: "transfer", username: "tester", from_location: "Aisle A", to_location: "Bin A-01", lot_number: "", created_at: "2026-01-01T11:00:00" },
      ],
    });
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByLabelText("View Aisle A"));
    fireEvent.click(await screen.findByRole("button", { name: /Activity \(2\)/ }));
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.getByText("Aisle A → Bin A-01")).toBeInTheDocument();
    expect(screen.getByText("LOT-1")).toBeInTheDocument();
  });

  it("opens the detail modal for a location deep link", async () => {
    mockLocations([mockLocationTree({ id: 2, code: "B-01", name: "Bin B", path: "Bin B", location_type: "bin", children: [] })]);
    renderWithProviders(<Locations />, { route: "/locations?location=2" });
    expect(await screen.findByText("Stock (1)")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
  });

  it("closes the detail modal with a single click on the X", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByLabelText("View Aisle A"));
    expect(await screen.findByText("Stock (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await vi.waitFor(() => expect(screen.queryByText("Stock (1)")).not.toBeInTheDocument());
  });

  it("does not reopen the detail modal after closing it", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByLabelText("View Aisle A"));
    expect(await screen.findByText("Stock (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await vi.waitFor(() => expect(screen.queryByText("Stock (1)")).not.toBeInTheDocument());
    expect(screen.queryByText("Stock (1)")).not.toBeInTheDocument();
  });

  it("exports locations through the CSV report endpoint", async () => {
    mockLocations([mockLocationTree()]);
    URL.createObjectURL = vi.fn(() => "blob:locations");
    renderWithProviders(<Locations />);
    expect(await screen.findByText("Aisle A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export locations to CSV" }));
    await vi.waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/reports/export/locations", expect.objectContaining({ responseType: "blob" }))
    );
    expect(await screen.findByText("Locations exported to CSV")).toBeInTheDocument();
  });

  it("shows the server message when deleting fails", async () => {
    mockLocations([mockLocationTree()]);
    (api.delete as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { detail: [{ msg: "Cannot delete a location with stock movement history" }] } },
    });
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByLabelText("Delete Aisle A"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Cannot delete a location with stock movement history")).toBeInTheDocument();
  });

  it("shows validation errors from the server when saving fails", async () => {
    mockLocations([mockLocationTree()]);
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { detail: [{ msg: "Invalid location type 'binn'" }] } },
    });
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Location" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Aisle A, Bin A-01"), { target: { value: "Bin B-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Invalid location type 'binn'")).toBeInTheDocument();
  });

  it("creates a location through the form including the active toggle", async () => {
    mockLocations([mockLocationTree()]);
    renderWithProviders(<Locations />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Location" }));
    expect(screen.getByPlaceholderText("e.g. Aisle A, Bin A-01")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("e.g. Aisle A, Bin A-01"), { target: { value: "Bin B-02" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. A-01"), { target: { value: "B-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/locations", expect.objectContaining({ name: "Bin B-02", code: "B-02", is_active: true }))
    );
  });
});
