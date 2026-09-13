import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Orders from "../pages/Orders";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

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

  it("hides delete action for received orders", async () => {
    mockOrders([mockOrder(), mockOrder({ id: 2, order_number: "PO-1002", status: "received" })]);
    renderWithProviders(<Orders />);
    expect(await screen.findByText("PO-1001")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete order PO-1001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Delete order PO-1002")).not.toBeInTheDocument();
  });

  it("exports the full order list through the CSV report endpoint", async () => {
    mockOrders([mockOrder()]);
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
      if (url === "/orders") return Promise.resolve({ data: { items: [mockOrder()], total: 1, page: 1, pages: 1 } });
      if (url === "/reports/export/orders") return Promise.resolve({ data: new Blob(["a,b,c"], { type: "text/csv" }) });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    URL.createObjectURL = vi.fn(() => "blob:orders");
    renderWithProviders(<Orders />);
    await screen.findByText("PO-1001");
    fireEvent.click(screen.getByRole("button", { name: "Export orders to CSV" }));
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledWith("/reports/export/orders", expect.objectContaining({ responseType: "blob" })));
    expect(await screen.findByText("Orders exported to CSV")).toBeInTheDocument();
  });

  it("runs auto-reorder through the confirm dialog", async () => {
    mockOrders([mockOrder()]);
    postMock.mockResolvedValue({ data: [{ order_number: "PO-2000", items: [{ product_id: 1 }] }] });
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
    const dialog = screen.getByRole("dialog");
    fireEvent.change(await screen.findByLabelText("Supplier"), { target: { value: "1" } });
    const getProductSelect = () =>
      within(dialog)
        .getAllByRole("combobox", { name: "Product" })[0];
    await vi.waitFor(() => {
      const allOptions = screen.getAllByRole("option");
      const labels = allOptions.map((o) => o.textContent || "");
      expect(labels.some((l) => l.includes("Widget"))).toBe(true);
      expect(labels.some((l) => l.includes("Gadget"))).toBe(true);
    });
    fireEvent.change(getProductSelect(), { target: { value: "10" } });
    expect(getProductSelect()).toHaveValue("Widget (SUP-1) (€6.00)");
    await vi.waitFor(() => expect((screen.getByPlaceholderText("Price") as HTMLInputElement).value).toBe("6"));
    fireEvent.click(screen.getByRole("button", { name: "Create Order" }));
    await vi.waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/orders", expect.objectContaining({
        supplier_id: 1,
        expected_arrival: null,
        items: [{ product_id: 10, quantity: 1, unit_price: 6 }],
      }))
    );
  });

  it("blocks adding the same product twice to an order", async () => {
    const product = (id: number, sku: string, name: string, price: number) => ({
      id, sku, name, display_name: name, is_active: true, is_variant: false, parent_id: null,
      location_id: 1, location: "Main", quantity: 0, total_quantity: 0, unit_price: price, cost_price: price - 2,
      reorder_level: 5, supplier_id: null, supplier_name: "", variants: [], category_name: "",
      description: "", barcode: "", batch_number: "", image_url: "", expiry_date: null, attributes: null,
      is_serialized: false, created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
    });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
      if (url === "/orders") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products") return Promise.resolve({ data: { items: [product(10, "P1", "Widget", 8)], total: 1, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 1, name: "Main", is_active: true }] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Orders />);
    fireEvent.click(await screen.findByRole("button", { name: "New Order" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Item" }));
    await screen.findAllByText(/Widget/);
    const productSelects = () => screen.getAllByRole("combobox", { name: "Product" });
    fireEvent.change(productSelects()[0], { target: { value: "10" } });
    fireEvent.change(productSelects()[1], { target: { value: "10" } });
    expect(await screen.findByText("Product already added to this order")).toBeInTheDocument();
  });

  it("opens the edit slide-over for a pending order and saves updates", async () => {
    const order = mockOrder();
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
      if (url === "/orders") return Promise.resolve({ data: { items: [order], total: 1, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies" }], total: 1, page: 1, pages: 1 } });
      if (url === "/products") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 1, name: "Main", is_active: true }] } });
      if (url === "/suppliers/1/products") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Orders />);
    fireEvent.click(await screen.findByLabelText("Edit order PO-1001"));
    const dialog = await screen.findByRole("dialog", { name: "Edit order PO-1001" });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "Updated notes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Order" }));
    await vi.waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/orders/1", expect.objectContaining({ notes: "Updated notes" }))
    );
  });

  it("previews the PDF for a received order from its detail view", async () => {
    const order = mockOrder({ id: 2, order_number: "PO-1002", status: "received", total_amount: 300 });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
      if (url === "/orders") return Promise.resolve({ data: { items: [order], total: 1, page: 1, pages: 1 } });
      if (url === `/orders/${order.id}/pdf`) return Promise.resolve({ data: new Blob(["%PDF-1.4"], { type: "application/pdf" }) });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/lpns") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    URL.createObjectURL = vi.fn(() => "blob:order-pdf");
    renderWithProviders(<Orders />);
    fireEvent.click(await screen.findByLabelText("View order PO-1002"));
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledWith(`/orders/2/pdf`, expect.objectContaining({ responseType: "blob" })));
    expect(await screen.findByTitle("PDF preview of PO-1002")).toBeInTheDocument();
  });

  it("does not show the edit action in the detail slide-over for a received order", async () => {
    const order = mockOrder({ id: 2, order_number: "PO-1002", status: "received" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "€" } });
      if (url === "/orders") return Promise.resolve({ data: { items: [order], total: 1, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      if (url === "/lpns") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Orders />);
    fireEvent.click(await screen.findByLabelText("View order PO-1002"));
    expect(await screen.findByRole("dialog", { name: "Order PO-1002" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit order PO-1002" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("shows placed and received date+time in the order table", async () => {
    mockOrders([
      mockOrder(),
      mockOrder({
        id: 2,
        order_number: "PO-1002",
        status: "received",
        created_at: "2026-01-03T09:00:00",
        received_at: "2026-01-05T14:30:00",
      }),
    ]);
    renderWithProviders(<Orders />);
    expect(await screen.findByText("PO-1001")).toBeInTheDocument();
    expect(screen.getByText("2026-01-01 10:00")).toBeInTheDocument();
    expect(screen.getByText("2026-01-03 09:00")).toBeInTheDocument();
    expect(screen.getByText("2026-01-05 14:30")).toBeInTheDocument();
  });

  it("flags pending orders past their expected arrival as overdue", async () => {
    mockOrders([mockOrder({ expected_arrival: "2020-01-01T00:00:00" })]);
    renderWithProviders(<Orders />);
    expect(await screen.findByText("PO-1001")).toBeInTheDocument();
    expect(screen.getByText(/Overdue 2020-01-01 00:00/)).toBeInTheDocument();
  });
});
