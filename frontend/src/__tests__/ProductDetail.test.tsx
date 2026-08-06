import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, makeProduct, makeVariant } from "./testUtils";
import { useLocation } from "react-router-dom";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import ProductDetail from "../components/ProductDetail";

const getMock = api.get as ReturnType<typeof vi.fn>;

describe("ProductDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows all stock locations (including transferred) for a non-serialized product", async () => {
    const product = makeProduct({ id: 5, sku: "SKU-5", name: "Widget", location: "A1" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({
          data: { locations: [
            { location_id: 1, path: "Aisle A", is_active: true, quantity: 5 },
            { location_id: 2, path: "Shelf B", is_active: true, quantity: 3 },
          ], unallocated: 0 },
        });
      }
      if (url === "/products/5/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Stock Locations:")).toBeInTheDocument();
    expect(screen.getByText("Aisle A (5)")).toBeInTheDocument();
    expect(screen.getByText("Shelf B (3)")).toBeInTheDocument();
  });

  it("groups in-stock serials by their current location for a serialized product", async () => {
    const product = makeProduct({ id: 6, sku: "SKU-6", name: "Serial Widget", is_serialized: true });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/serial-numbers") {
        return Promise.resolve({
          data: {
            items: [
              { id: 1, product_id: 6, serial_number: "SN-1", lot_id: null, location_id: 1, status: "in_stock", location_name: "Aisle A", sold_at: null, lot_number: "", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
              { id: 2, product_id: 6, serial_number: "SN-2", lot_id: null, location_id: 2, status: "in_stock", location_name: "Shelf B", sold_at: null, lot_number: "", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
              { id: 3, product_id: 6, serial_number: "SN-3", lot_id: null, location_id: 1, status: "in_stock", location_name: "Aisle A", sold_at: null, lot_number: "", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
            ],
            total: 3,
            page: 1,
            pages: 1,
          },
        });
      }
      if (url === "/products/6/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("In-stock Serial Locations:")).toBeInTheDocument();
    expect(screen.getByText("Aisle A (2)")).toBeInTheDocument();
    expect(screen.getByText("Shelf B (1)")).toBeInTheDocument();
  });

  it("navigates to the locations page detail when a stock location is clicked", async () => {
    const product = makeProduct({ id: 7, sku: "SKU-7", name: "Widget" });
    let captured: string | null = null;
    function Probe() {
      const location = useLocation();
      captured = location.pathname + location.search;
      return <ProductDetail product={product} onClose={() => {}} />;
    }
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({
          data: { locations: [{ location_id: 3, path: "Bin C", is_active: true, quantity: 4 }], unallocated: 0 },
        });
      }
      if (url === "/products/7/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<Probe />);

    const badge = await screen.findByRole("button", { name: "View location Bin C" });
    expect(badge).toHaveTextContent("Bin C (4)");
    fireEvent.click(badge);
    await waitFor(() => expect(captured).toBe("/locations?location=3"));
  });

  it("shows the parent product as 'Variant of' even when the variant has its own name", async () => {
    const parent = makeProduct({ id: 10, sku: "SKU-P", name: "Original Shirt" });
    const product = makeVariant(parent, { id: 11, sku: "SKU-V", name: "Custom Variant Name" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/11/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Variant of:")).toBeInTheDocument();
    expect(screen.getByText("Original Shirt")).toBeInTheDocument();
  });

  it("shows an Unallocated badge when stock exists without a location", async () => {
    const product = makeProduct({ id: 8, sku: "SKU-8", name: "Widget", location: "A1" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({
          data: { locations: [{ location_id: 1, path: "Aisle A", is_active: true, quantity: 5 }], unallocated: 7 },
        });
      }
      if (url === "/products/8/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Stock Locations:")).toBeInTheDocument();
    expect(screen.getByText("Aisle A (5)")).toBeInTheDocument();
    expect(screen.getByText("Unallocated (7)")).toBeInTheDocument();
  });

  it("moves unallocated stock to a chosen location from the badge", async () => {
    const product = makeProduct({ id: 9, sku: "SKU-9", name: "Widget", location: "A1" });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { reference: "UNL-0001", count: 2, movements: [] },
    });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 10, path: "Shelf A", is_active: true }], total: 1, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations")
        return Promise.resolve({ data: { locations: [{ location_id: 1, path: "Aisle A", is_active: true, quantity: 5 }], unallocated: 7 } });
      if (url === "/products/9/trace")
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    const badge = await screen.findByRole("button", { name: "Move unallocated stock" });
    fireEvent.click(badge);

    expect(await screen.findByText("Move Unallocated Stock")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue(7);
    await screen.findByRole("option", { name: "Shelf A" });
    fireEvent.change(screen.getByLabelText("Destination Location"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Stock" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements/unallocated-move", {
        product_id: 9,
        quantity: 7,
        to_location_id: 10,
        notes: "",
      })
    );
  });
});
