import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import ASNs from "../pages/ASNs";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockASN(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    asn_number: "ASN-0001",
    supplier_id: 1,
    user_id: 1,
    status: "pending",
    expected_arrival: "2026-02-01",
    received_at: null,
    total_expected: 10,
    total_received: 0,
    notes: "",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    supplier_name: "Acme Supplies",
    username: "tester",
    items: [
      {
        id: 1,
        asn_id: 1,
        product_id: 1,
        expected_qty: 10,
        received_qty: 0,
        unit_cost: 5,
        status: "pending",
        product_name: "Widget",
        location_id: null,
        location_name: "",
      },
    ],
    ...overrides,
  };
}

function mockASNs(items: ReturnType<typeof mockASN>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/asns") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (url === "/products")
      return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, variants: [] }], total: 1, page: 1, pages: 1 } });
    if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
    if (url === "/locations") return Promise.resolve({ data: { items: [] } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("ASNs Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders ASN rows with supplier and progress", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />);
    expect(await screen.findByText("ASN-0001")).toBeInTheDocument();
    const table = screen.getByRole("grid", { name: "ASNs table" });
    expect(within(table).getByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByLabelText("Receive progress for ASN-0001")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />);
    expect(await screen.findByText("ASN-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New ASN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive" })).toBeInTheDocument();
    expect(screen.getByLabelText("View ASN-0001")).toBeInTheDocument();
  });

  it("shows cancel and delete actions for pending ASNs to admins", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />);
    expect(await screen.findByText("ASN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel ASN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete ASN-0001")).toBeInTheDocument();
  });

  it("cancels an ASN via the confirm dialog", async () => {
    mockASNs([mockASN()]);
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: { ...mockASN(), status: "cancelled" } });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByLabelText("Cancel ASN-0001"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel ASN" }));
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/asns/1", { status: "cancelled" });
    });
  });

  it("deletes a pending ASN via the confirm dialog", async () => {
    mockASNs([mockASN()]);
    const deleteMock = api.delete as ReturnType<typeof vi.fn>;
    deleteMock.mockResolvedValue({ data: { deleted: 1 } });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByLabelText("Delete ASN-0001"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith("/asns/1");
    });
  });

  it("edits an ASN's arrival date and notes via the edit form", async () => {
    mockASNs([mockASN()]);
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: { ...mockASN(), notes: "updated note" } });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByLabelText("Edit ASN-0001"));
    const dialog = await screen.findByRole("dialog", { name: "Edit ASN-0001" });
    fireEvent.change(within(dialog).getByLabelText("Expected Arrival"), { target: { value: "2026-02-15" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "updated note" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/asns/1", expect.objectContaining({
        expected_arrival: "2026-02-15",
        notes: "updated note",
      }));
    });
  });

  it("hides edit action for workers without asns.update", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />, { role: "worker" });
    expect(await screen.findByText("ASN-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit ASN-0001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cancel ASN-0001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete ASN-0001")).not.toBeInTheDocument();
  });

  it("hides admin actions for workers", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />, { role: "worker" });
    expect(await screen.findByText("ASN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("View ASN-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New ASN" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive" })).toBeInTheDocument();
  });

  it("shows empty state when no ASNs", async () => {
    mockASNs([]);
    renderWithProviders(<ASNs />);
    expect(await screen.findByText("No ASNs yet")).toBeInTheDocument();
  });

  it("opens the new ASN form with selectable products", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    expect(await screen.findByRole("option", { name: "Widget (SKU-1)" })).toBeInTheDocument();
  });

  it("lists the selected supplier's products as selectable options", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [
          { id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] },
          { id: 2, name: "Gadget", sku: "SKU-2", display_name: "Gadget", is_active: true, is_variant: false, is_serialized: false, variants: [] },
        ], total: 2, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/suppliers/1/products")
        return Promise.resolve({ data: { items: [
          { id: 2, name: "Gadget", sku: "SKU-2", display_name: "Gadget", cost_price: 4.5, supplier_id: 1, is_active: true },
        ], total: 1, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    const dialog = await screen.findByRole("dialog", { name: "New ASN" });
    await screen.findByRole("option", { name: "Acme Supplies" });
    fireEvent.change(within(dialog).getByLabelText("Supplier"), { target: { value: "1" } });

    expect(await screen.findByText(/1 linked product/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gadget (SKU-2)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Widget (SKU-1)" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Product")).toHaveValue("Select...");
  });

  it("keeps manual rows when the user changed supplier after adding items", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [
          { id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] },
          { id: 2, name: "Gadget", sku: "SKU-2", display_name: "Gadget", is_active: true, is_variant: false, is_serialized: false, variants: [] },
        ], total: 2, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/suppliers/1/products")
        return Promise.resolve({ data: { items: [
          { id: 2, name: "Gadget", sku: "SKU-2", display_name: "Gadget", cost_price: 4.5, supplier_id: 1, is_active: true },
        ], total: 1, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    const dialog = await screen.findByRole("dialog", { name: "New ASN" });
    await screen.findByRole("option", { name: "Acme Supplies" });
    await screen.findByRole("option", { name: "Widget (SKU-1)" });
    fireEvent.change(within(dialog).getByLabelText("Product"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Supplier"), { target: { value: "1" } });
    await waitFor(() => expect(screen.queryByText("Loading supplier products...")).not.toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByLabelText("Product")).toHaveValue("Widget (SKU-1)"));
    expect(screen.getByRole("option", { name: "Widget (SKU-1)" })).toBeInTheDocument();
    expect(screen.queryByText(/Loaded 1 product/)).not.toBeInTheDocument();
  });

  it("removes an unwanted product row", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [
          { id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] },
          { id: 2, name: "Gadget", sku: "SKU-2", display_name: "Gadget", is_active: true, is_variant: false, is_serialized: false, variants: [] },
        ], total: 2, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    await screen.findByRole("option", { name: "Widget (SKU-1)" });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Item" }));
    const selects = screen.getAllByLabelText("Product");
    fireEvent.change(selects[1], { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
    await waitFor(() => expect(screen.getAllByLabelText("Product")).toHaveLength(1));
    expect(screen.getByLabelText("Product")).toHaveValue("Widget (SKU-1)");
  });

  it("lists variant products under the supplier as selectable options", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/suppliers/1/products")
        return Promise.resolve({ data: { items: [
          {
            id: 10, name: "T-Shirt", sku: "TSHIRT", display_name: "T-Shirt", supplier_id: null, is_active: true,
            is_variant: false, is_serialized: false, variants: [
              { id: 11, name: "T-Shirt", sku: "TSHIRT-RED-M", display_name: "T-Shirt - Red / M", supplier_id: 1, is_active: true, is_variant: true, is_serialized: false, variants: [] },
              { id: 12, name: "T-Shirt", sku: "TSHIRT-BLUE-L", display_name: "T-Shirt - Blue / L", supplier_id: 1, is_active: true, is_variant: true, is_serialized: false, variants: [] },
            ],
          },
        ], total: 1, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    const dialog = await screen.findByRole("dialog", { name: "New ASN" });
    await screen.findByRole("option", { name: "Acme Supplies" });
    fireEvent.change(within(dialog).getByLabelText("Supplier"), { target: { value: "1" } });

    expect(await screen.findByRole("option", { name: "T-Shirt - Red / M (TSHIRT-RED-M)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "T-Shirt - Blue / L (TSHIRT-BLUE-L)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "T-Shirt (TSHIRT)" })).not.toBeInTheDocument();
  });

  it("auto-fills the unit cost when a product is selected", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", cost_price: 3.25, is_active: true, is_variant: false, is_serialized: false, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    await screen.findByRole("option", { name: "Widget (SKU-1)" });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByDisplayValue("3.25")).toBeInTheDocument());
  });

  it("sends the resolved location id when creating an ASN", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 42, name: "Aisle A", path: "Aisle A", is_active: true }] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    await screen.findByRole("option", { name: "Widget (SKU-1)" });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Aisle A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ASN" }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/asns", expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ product_id: 1, location_id: 42 }),
        ]),
      }));
    });
  });

  it("prefills the new ASN location from where the product's stock actually is", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [mockASN()], total: 1, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 10, name: "Warehouse B", path: "Warehouse B", is_active: true }] } });
      if (url === "/stock-movements/locations")
        return Promise.resolve({ data: { locations: [{ location_id: 10, path: "Warehouse B", is_active: true, quantity: 5 }], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    await screen.findByRole("option", { name: "Widget (SKU-1)" });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByLabelText("Location")).toHaveValue("Warehouse B"));
  });

  it("shows stock location chips without overriding when a product spans multiple locations", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [mockASN()], total: 1, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }] } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 10, name: "A", path: "A", is_active: true }, { id: 20, name: "B", path: "B", is_active: true }] } });
      if (url === "/stock-movements/locations")
        return Promise.resolve({ data: { locations: [
          { location_id: 10, path: "A", is_active: true, quantity: 3 },
          { location_id: 20, path: "B", is_active: true, quantity: 2 },
        ], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "New ASN" }));
    await screen.findByRole("option", { name: "Widget (SKU-1)" });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "1" } });
    expect(await screen.findByText("Stock is currently at:")).toBeInTheDocument();
    expect(screen.getByText("A (3)")).toBeInTheDocument();
    expect(screen.getByText("B (2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toHaveValue("");
  });

  it("prefills the receive location from where the product's serials actually are", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [mockASN()], total: 1, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: true, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 10, name: "Warehouse B", path: "Warehouse B", is_active: true }] } });
      if (url === "/serial-numbers")
        return Promise.resolve({ data: { items: [
          { id: 1, product_id: 1, serial_number: "SN-1", lot_id: null, location_id: 10, status: "in_stock", sold_at: null, location_name: "Warehouse B", lot_number: "", product_name: "Widget" },
        ], total: 1, page: 1, pages: 1 } });
      if (url === "/lpns") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "Receive" }));
    await waitFor(() => expect(screen.getByLabelText("Location")).toHaveValue("Warehouse B"));
  });

  it("sends lpn_id when receiving an ASN into an LPN", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/asns") return Promise.resolve({ data: { items: [mockASN()], total: 1, page: 1, pages: 1 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 10, name: "A", path: "A", is_active: true }] } });
      if (url === "/lpns")
        return Promise.resolve({ data: { items: [{ id: 5, lpn_number: "PAL-001", lpn_type: "pallet", location_id: 10, status: "active", created_at: "2026-01-01T10:00:00", location_name: "A", content_count: 0, total_quantity: 0, contents: [], serials: [] }] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<ASNs />);
    fireEvent.click(await screen.findByRole("button", { name: "Receive" }));
    expect(await screen.findByLabelText("LPN number")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("10"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("LPN number"), { target: { value: "PAL-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Stock" }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/asns/1/receive", expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ product_id: 1, received_qty: 2, lpn_id: 5 }),
        ]),
      }));
    });
  });
});
