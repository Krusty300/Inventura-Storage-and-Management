import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Orders from "../pages/Orders";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

function mockOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    order_number: "PO-1001",
    supplier_id: 1,
    supplier_name: "Acme Supplies",
    status: "pending",
    total_amount: 250,
    notes: "",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    items: [],
    ...overrides,
  };
}

function mockOrders(items: ReturnType<typeof mockOrder>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
    if (url === "/orders") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Orders Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders order rows with formatted total using the currency symbol", async () => {
    mockOrders([mockOrder()]);
    renderWithProviders(<Orders />);
    expect(await screen.findByText("PO-1001")).toBeInTheDocument();
    expect(screen.getByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("€250.00")).toBeInTheDocument();
  });

  it("shows edit action only for pending orders", async () => {
    mockOrders([mockOrder(), mockOrder({ id: 2, order_number: "PO-1002", status: "received" })]);
    renderWithProviders(<Orders />);
    expect(await screen.findByText("PO-1001")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit order PO-1001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit order PO-1002")).not.toBeInTheDocument();
  });

  it("runs auto-reorder through the confirm dialog", async () => {
    mockOrders([mockOrder()]);
    postMock.mockResolvedValue({ data: { order_number: "PO-2000", items: [{ product_id: 1 }] } });
    renderWithProviders(<Orders />);
    fireEvent.click(await screen.findByRole("button", { name: "Auto-reorder low stock" }));
    expect(screen.getByText(/Generate a purchase order for all products/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate PO" }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/orders/auto-reorder"));
  });

  it("shows empty state when no orders", async () => {
    mockOrders([]);
    renderWithProviders(<Orders />);
    expect(await screen.findByText("No orders")).toBeInTheDocument();
  });

  it("loads supplier products and adds selected items to a new order", async () => {
    const supplierProduct = (id: number, sku: string, name: string, price: number) => ({
      id, sku, name, display_name: name, is_active: true, is_variant: false, parent_id: null,
      location_id: 1, location: "Main", quantity: 0, total_quantity: 0, unit_price: price, cost_price: price - 2,
      reorder_level: 5, supplier_id: 1, supplier_name: "Acme Supplies", variants: [], category_name: "",
      description: "", barcode: "", batch_number: "", image_url: "", expiry_date: null, attributes: null,
      is_serialized: false, created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
    });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
      if (url === "/orders") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }], total: 1, page: 1, pages: 1 } });
      if (url === "/products") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 1, name: "Main", is_active: true }] } });
      if (url === "/suppliers/1/products") return Promise.resolve({ data: { items: [supplierProduct(10, "SUP-1", "Widget", 8), supplierProduct(11, "SUP-2", "Gadget", 10)], total: 2, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Orders />);
    fireEvent.click(await screen.findByRole("button", { name: "New Order" }));
    fireEvent.change(await screen.findByLabelText("Supplier"), { target: { value: "1" } });
    expect(await screen.findByLabelText("Add Widget to order")).toBeInTheDocument();
    expect(screen.getByLabelText("Add Gadget to order")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Selected Items" }));
    expect(await screen.findByText("2 product(s) added from supplier")).toBeInTheDocument();
    await vi.waitFor(() => {
      const selects = screen.getAllByRole("combobox");
      expect(selects.some((el) => (el as HTMLSelectElement).value === "10")).toBe(true);
      expect(selects.some((el) => (el as HTMLSelectElement).value === "11")).toBe(true);
    });
  });
});
