import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Suppliers from "../pages/Suppliers";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockSuppliers(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
    if (url === "/suppliers") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Suppliers Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders supplier rows", async () => {
    mockSuppliers([{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St" }]);
    renderWithProviders(<Suppliers />);
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    expect(screen.getByText("555-0100")).toBeInTheDocument();
  });

  it("deletes a supplier through the confirm dialog", async () => {
    mockSuppliers([{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Suppliers />);
    fireEvent.click(await screen.findByLabelText("Delete Acme Supplies"));
    expect(screen.getByText(/Are you sure you want to deactivate "Acme Supplies"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/suppliers/1"));
  });

  it("shows empty state when no suppliers", async () => {
    mockSuppliers([]);
    renderWithProviders(<Suppliers />);
    expect(await screen.findByText("No suppliers")).toBeInTheDocument();
  });

  it("renders analytics columns and inactive badge", async () => {
    mockSuppliers([{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St", is_active: false, total_orders: 3, total_spent: 240, product_count: 5 }]);
    renderWithProviders(<Suppliers />);
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("$240.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Show inactive")).toBeInTheDocument();
    expect(screen.getByLabelText("Restore Acme Supplies")).toBeInTheDocument();
  });

  it("shows products by supplier in the detail modal", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/suppliers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St" }], total: 1, page: 1, pages: 1 } });
      if (url === "/suppliers/1/stats") return Promise.resolve({ data: { total_orders: 2, total_spent: 100, avg_order_value: 50, last_order_at: null, product_count: 2 } });
      if (url === "/orders") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/suppliers/1/products") return Promise.resolve({ data: { items: [
        { id: 10, sku: "PRD-1", name: "Widget", category_name: "Parts", supplier_name: "Acme Supplies", unit_price: 12.5, quantity: 4, total_quantity: 4, is_active: true, variants: [] },
        { id: 11, sku: "PRD-2", name: "Gadget", category_name: "Parts", supplier_name: "Acme Supplies", unit_price: 8, quantity: 0, total_quantity: 0, is_active: false, variants: [] },
      ], total: 2, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Suppliers />);
    fireEvent.click(await screen.findByLabelText("View Acme Supplies"));
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Products by Supplier")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    expect(screen.getByText("PRD-1")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });
});
