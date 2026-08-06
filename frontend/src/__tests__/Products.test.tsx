import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, makeProduct, makeVariant } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Products from "../pages/Products";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockProducts(items: ReturnType<typeof makeProduct>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/categories") return Promise.resolve({ data: { items: [] } });
    if (url === "/products") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Products Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders product rows with name, sku and price", async () => {
    mockProducts([makeProduct({ id: 1, sku: "ABC-1", name: "Widget", unit_price: 12.5 })]);
    renderWithProviders(<Products />);
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("ABC-1")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
  });

  it("renders the supplier column with supplier names", async () => {
    mockProducts([
      makeProduct({ id: 1, sku: "ABC-1", name: "Widget", supplier_name: "Acme Supplies" }),
      makeProduct({ id: 2, sku: "ABC-2", name: "Gadget" }),
    ]);
    renderWithProviders(<Products />);
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort by supplier")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
  });

  it("renders variant rows under a group with a variant count badge", async () => {
    const parent = makeProduct({ id: 2, sku: "P-2", name: "T-Shirt" });
    const variant = makeVariant(parent, { sku: "V-2" });
    mockProducts([{ ...parent, variants: [variant] }]);
    renderWithProviders(<Products />);
    expect(await screen.findByText("T-Shirt")).toBeInTheDocument();
    expect(screen.getByText("1 variants")).toBeInTheDocument();
    expect(screen.getByText("T-Shirt - Red")).toBeInTheDocument();
  });

  it("does not render inactive variants as a group", async () => {
    const parent = makeProduct({ id: 3, sku: "P-3", name: "Parent" });
    const inactive = makeVariant(parent, { id: 31, is_active: false });
    mockProducts([{ ...parent, variants: [inactive] }]);
    renderWithProviders(<Products />);
    await screen.findByText("Parent");
    expect(screen.queryByText("variants")).not.toBeInTheDocument();
    expect(screen.queryByText("Parent - Red")).not.toBeInTheDocument();
  });

  it("passes low_stock param and shows the clear badge when ?low_stock=1", async () => {
    const items = [makeProduct({ id: 4, sku: "LOW-1", name: "Low Item", quantity: 2, reorder_level: 10 })];
    getMock.mockImplementation((url: string, config?: any) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") {
        expect(config.params.low_stock).toBe("1");
        return Promise.resolve({ data: { items, total: 1, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Products />, { route: "/products?low_stock=1" });
    expect(await screen.findByText("Low Item")).toBeInTheDocument();
    expect(screen.getByLabelText("Clear low stock filter")).toBeInTheDocument();
  });

  it("shows empty state when no products", async () => {
    mockProducts([]);
    renderWithProviders(<Products />);
    expect(await screen.findByText("No products found")).toBeInTheDocument();
  });
});
