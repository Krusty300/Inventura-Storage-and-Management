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

  it("shows a quarantine badge when a product holds quarantined units", async () => {
    mockProducts([makeProduct({ id: 5, sku: "Q-1", name: "Quarantined Item", quantity: 10, reorder_level: 5, quarantined_qty: 4 })]);
    renderWithProviders(<Products />);
    expect(await screen.findByText("Quarantined Item")).toBeInTheDocument();
    expect(screen.getByText("Q4")).toBeInTheDocument();
    expect(screen.queryByText("Q5")).not.toBeInTheDocument();
  });

  it("sums quarantined units across a variant group on the parent row", async () => {
    const parent = makeProduct({ id: 6, sku: "PG-6", name: "Group Item" });
    const v1 = makeVariant(parent, { quarantined_qty: 2 });
    const v2 = makeVariant(parent, { id: 61, quarantined_qty: 3 });
    mockProducts([{ ...parent, variants: [v1, v2] }]);
    renderWithProviders(<Products />);
    await screen.findByText("Group Item");
    expect(screen.getByText("Q5")).toBeInTheDocument();
  });

  it("shows an expired badge when a product holds units in expired lots", async () => {
    mockProducts([makeProduct({ id: 9, sku: "E-1", name: "Expired Item", quantity: 10, reorder_level: 5, expired_lot_qty: 4 })]);
    renderWithProviders(<Products />);
    expect(await screen.findByText("Expired Item")).toBeInTheDocument();
    expect(screen.getByText("E4")).toBeInTheDocument();
    expect(screen.queryByText("E5")).not.toBeInTheDocument();
  });

  it("sums expired units across a variant group on the parent row", async () => {
    const parent = makeProduct({ id: 10, sku: "PG-10", name: "Group Expired" });
    const v1 = makeVariant(parent, { expired_lot_qty: 2 });
    const v2 = makeVariant(parent, { id: 101, expired_lot_qty: 3 });
    mockProducts([{ ...parent, variants: [v1, v2] }]);
    renderWithProviders(<Products />);
    await screen.findByText("Group Expired");
    expect(screen.getByText("E5")).toBeInTheDocument();
  });

  it("flags low stock based on sellable quantity excluding quarantined units", async () => {
    const items = [
      makeProduct({ id: 7, sku: "LS-1", name: "Sellable Low", quantity: 10, reorder_level: 8, quarantined_qty: 4, sellable_qty: 6 }),
      makeProduct({ id: 8, sku: "LS-2", name: "Sellable Fine", quantity: 10, reorder_level: 8, quarantined_qty: 1, sellable_qty: 9 }),
    ];
    mockProducts(items);
    renderWithProviders(<Products />);
    await screen.findByText("Sellable Low");
    expect(screen.getByLabelText("Low stock")).toBeInTheDocument();
    expect(screen.getByText("S6")).toBeInTheDocument();
    expect(screen.getByText("S9")).toBeInTheDocument();
  });

  it("counts quarantined serials in on-hand and keeps sellable as the in-stock subset", async () => {
    // Serialized on-hand (quantity) includes quarantined serials (parity with
    // bulk, where quarantined lots stay on-hand); sellable is the in-stock subset,
    // so it is qty - quarantined, shown via the S badge.
    mockProducts([makeProduct({
      id: 12, sku: "SER-Q", name: "Serialized Quarantined",
      quantity: 8, reorder_level: 4, quarantined_qty: 3, sellable_qty: 5, is_serialized: true,
    })]);
    renderWithProviders(<Products />);
    await screen.findByText("Serialized Quarantined");
    expect(screen.queryByLabelText("Low stock")).not.toBeInTheDocument();
    expect(screen.getByText("Q3")).toBeInTheDocument();
    expect(screen.getByText("S5")).toBeInTheDocument();
  });
});
