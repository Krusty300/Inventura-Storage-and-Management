import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Customers from "../pages/Customers";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockCustomers(
  items: Record<string, unknown>[],
  opts: { frequentProducts?: Record<string, unknown>[]; stats?: Record<string, unknown> } = {}
) {
  getMock.mockImplementation((url: string) => {
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
    if (url === "/customers") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (url === "/customers/1/stats") return Promise.resolve({ data: { total_sales: 1, total_spent: 10, avg_order_value: 10, last_purchase_at: null, ...(opts.stats || {}) } });
    if (url === "/customers/1/frequent-products") return Promise.resolve({ data: opts.frequentProducts || [] });
    if (url === "/sales") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Customers Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders customer rows with type badge", async () => {
    mockCustomers([{ id: 1, name: "Bob", phone: "555-0111", email: "bob@example.com", customer_type: "frequent", notes: "Regular buyer", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Customers />);
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("555-0111")).toBeInTheDocument();
    expect(screen.getByText("frequent")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by type")).toBeInTheDocument();
  });

  it("deletes a customer through the confirm dialog", async () => {
    mockCustomers([{ id: 1, name: "Bob", phone: "555-0111", email: "bob@example.com", customer_type: "walk-in", notes: "", created_at: "2026-01-01T00:00:00" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Customers />);
    fireEvent.click(await screen.findByLabelText("Delete Bob"));
    expect(screen.getByText(/Are you sure you want to deactivate "Bob"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/customers/1"));
  });

  it("shows empty state when no customers", async () => {
    mockCustomers([]);
    renderWithProviders(<Customers />);
    expect(await screen.findByText("No customers found")).toBeInTheDocument();
  });

  it("shows frequently purchased products in the customer detail", async () => {
    mockCustomers(
      [{ id: 1, name: "Bob", phone: "555-0111", email: "bob@example.com", customer_type: "frequent", notes: "", created_at: "2026-01-01T00:00:00" }],
      {
        frequentProducts: [
          { product_id: 10, product_name: "Widget", sku: "SKU-10", order_count: 3, total_quantity: 7 },
          { product_id: 11, product_name: "Gadget", sku: "SKU-11", order_count: 1, total_quantity: 2 },
        ],
      }
    );
    renderWithProviders(<Customers />);
    fireEvent.click(await screen.findByLabelText("View Bob"));
    expect(await screen.findByText("Frequently Purchased")).toBeInTheDocument();
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("SKU-10")).toBeInTheDocument();
    expect(screen.getByText("Times Ordered")).toBeInTheDocument();
  });

  it("shows an empty frequent-products state when the customer has no purchases", async () => {
    mockCustomers([{ id: 1, name: "Bob", phone: "555-0111", email: "bob@example.com", customer_type: "walk-in", notes: "", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Customers />);
    fireEvent.click(await screen.findByLabelText("View Bob"));
    expect(await screen.findByText("Frequently Purchased")).toBeInTheDocument();
    expect(await screen.findByText("No purchase history yet")).toBeInTheDocument();
  });

  it("uses the default items per page from settings", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { default_items_per_page: 10 } });
      if (url === "/customers") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Customers />);
    await vi.waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/customers", expect.objectContaining({ params: expect.objectContaining({ limit: "10" }) }))
    );
  });
});
