import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("0/10")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockASNs([mockASN()]);
    renderWithProviders(<ASNs />);
    expect(await screen.findByText("ASN-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New ASN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive" })).toBeInTheDocument();
    expect(screen.getByLabelText("View ASN-0001")).toBeInTheDocument();
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
