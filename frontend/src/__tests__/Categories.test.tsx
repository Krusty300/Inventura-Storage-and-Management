import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Categories from "../pages/Categories";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockCategories(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/categories") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Categories Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders category rows", async () => {
    mockCategories([{ id: 1, name: "Beverages", description: "Drinks", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Categories />);
    expect(await screen.findByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Drinks")).toBeInTheDocument();
  });

  it("deletes a category through the confirm dialog", async () => {
    mockCategories([{ id: 1, name: "Beverages", description: "Drinks", created_at: "2026-01-01T00:00:00" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Categories />);
    fireEvent.click(await screen.findByLabelText("Delete Beverages"));
    expect(screen.getByText(/Are you sure you want to delete "Beverages"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/categories/1"));
  });

  it("shows empty state when no categories", async () => {
    mockCategories([]);
    renderWithProviders(<Categories />);
    expect(await screen.findByText("No categories")).toBeInTheDocument();
  });

  it("shows products and suppliers in the category detail view", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [{ id: 1, name: "Beverages", description: "Drinks", created_at: "2026-01-01T00:00:00" }], total: 1, page: 1, pages: 1 } });
      if (url === "/products") return Promise.resolve({ data: { items: [
        { id: 10, sku: "CAT-1", name: "Widget", display_name: "Widget", is_active: true, is_variant: false, quantity: 4, total_quantity: 4, unit_price: 12.5, cost_price: 5, reorder_level: 5, variants: [], category_name: "Beverages" },
        { id: 11, sku: "CAT-2", name: "Gadget", display_name: "Gadget", is_active: false, is_variant: false, quantity: 0, total_quantity: 0, unit_price: 8, cost_price: 3, reorder_level: 5, variants: [], category_name: "Beverages" },
      ], total: 2, page: 1, pages: 1 } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [
        { id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555", address: "1 Main", notes: "", is_active: true },
        { id: 2, name: "Old Supply", contact_person: "Bob", email: "bob@old.com", phone: "", address: "", notes: "", is_active: false },
      ], total: 2, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Categories />);
    fireEvent.click(await screen.findByLabelText("View Beverages"));
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    expect(screen.getByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Old Supply")).toBeInTheDocument();
    expect(screen.getAllByText("Deactivated").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("View product Widget"));
    expect(await screen.findByRole("dialog", { name: "Widget" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Close panel").pop()!);

    fireEvent.click(screen.getByLabelText("View supplier Acme Supplies"));
    expect(await screen.findByRole("dialog", { name: "Acme Supplies" })).toBeInTheDocument();
  });
});
