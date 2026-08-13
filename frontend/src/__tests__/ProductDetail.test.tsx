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
const putMock = api.put as ReturnType<typeof vi.fn>;

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

  it("shows inbound and outbound traceability movements for a variant", async () => {
    const parent = makeProduct({ id: 20, sku: "SKU-TP", name: "Tee" });
    const product = makeVariant(parent, { id: 21, sku: "SKU-TV", name: "Tee Red" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      }
      if (url === "/products/21/trace") {
        return Promise.resolve({
          data: {
            incoming: [
              { id: 1, created_at: "2026-01-01T10:00:00", movement_type: "receive", quantity_change: 10, reference_type: "receipt", reference: "RCV-0001", notes: "", lot_number: "LOT-A", username: "tester", from_location_name: "", to_location_name: "Bin A" },
            ],
            outgoing: [
              { id: 2, created_at: "2026-01-02T10:00:00", movement_type: "ship", quantity_change: -3, reference_type: "shipment", reference: "SHP-0001", notes: "", lot_number: "LOT-A", username: "tester", from_location_name: "Shipping", to_location_name: "" },
            ],
            work_orders: [],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Inbound Movements")).toBeInTheDocument();
    expect(screen.getByText("Outbound Movements")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
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

  it("moves unallocated serialized stock to a chosen location by selecting serial numbers", async () => {
    const product = makeProduct({ id: 13, sku: "SKU-13", name: "Serial Widget", is_serialized: true });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { reference: "UNL-0002", count: 4, movements: [] },
    });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/locations")
        return Promise.resolve({ data: { items: [{ id: 10, path: "Shelf A", is_active: true }], total: 1, page: 1, pages: 1 } });
      if (url === "/serial-numbers") {
        return Promise.resolve({
          data: {
            items: [
              { id: 1, product_id: 13, serial_number: "SN-U1", lot_id: null, location_id: null, status: "in_stock", location_name: "", sold_at: null, lot_number: "", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
              { id: 2, product_id: 13, serial_number: "SN-U2", lot_id: null, location_id: null, status: "in_stock", location_name: "", sold_at: null, lot_number: "", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
            ],
            total: 2,
            page: 1,
            pages: 1,
          },
        });
      }
      if (url === "/products/13/trace")
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    const badge = await screen.findByRole("button", { name: "Move unallocated stock" });
    expect(badge).toHaveTextContent("Unallocated (2)");
    fireEvent.click(badge);

    expect(await screen.findByText("Move Unallocated Stock")).toBeInTheDocument();
    expect(await screen.findByText("SN-U1")).toBeInTheDocument();
    expect(screen.getByText("SN-U2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    await screen.findByRole("option", { name: "Shelf A" });
    fireEvent.change(screen.getByLabelText("Destination Location"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Stock" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements/unallocated-move", {
        product_id: 13,
        quantity: 2,
        to_location_id: 10,
        serial_ids: [1, 2],
        notes: "",
      })
    );
  });

  it("shows the product status as a badge and toggles it directly from the detail view", async () => {
    const product = makeProduct({ id: 5, sku: "SKU-5", name: "Widget", location: "A1" });
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: { ...product, is_active: false } });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({
          data: { locations: [{ location_id: 1, path: "Aisle A", is_active: true, quantity: 5 }], unallocated: 0 },
        });
      }
      if (url === "/products/5/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    const statusButton = await screen.findByRole("button", { name: "Toggle status for Widget" });
    expect(statusButton).toHaveTextContent("Active");

    fireEvent.click(statusButton);
    expect(await screen.findByRole("dialog", { name: "Deactivate Product" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/products/5", { is_active: false }));
    expect(screen.getByRole("button", { name: "Toggle status for Widget" })).toHaveTextContent("Inactive");
  });

  it("shows a non-interactive status badge for users without the update permission", async () => {
    const product = makeProduct({ id: 12, sku: "SKU-12", name: "Widget" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/12/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />, { role: "worker" });

    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle status for Widget" })).not.toBeInTheDocument();
  });

  it("shows an Expired badge when the product holds units in expired lots", async () => {
    const product = makeProduct({ id: 14, sku: "SKU-14", name: "Expired Widget", expired_lot_qty: 4 });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/14/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Expired 4")).toBeInTheDocument();
  });

  it("shows a Quarantined badge when the product holds units in quarantined lots", async () => {
    const product = makeProduct({ id: 16, sku: "SKU-16", name: "Quarantined Widget", quarantined_qty: 3 });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/16/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Quarantined 3")).toBeInTheDocument();
  });

  it("does not show a Quarantined badge when no units are in quarantined lots", async () => {
    const product = makeProduct({ id: 15, sku: "SKU-15", name: "Fresh Widget" });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/15/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Quantity:")).toBeInTheDocument();
    expect(screen.queryByText(/Quarantined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expired/)).not.toBeInTheDocument();
  });

  it("shows quarantined lots with a release quick action", async () => {
    const product = makeProduct({ id: 5, sku: "SKU-5", name: "Widget", quarantined_qty: 3 });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      }
      if (url === "/products/5/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      if (url === "/lots") {
        return Promise.resolve({
          data: {
            items: [
              { id: 10, product_id: 5, lot_number: "LOT-Q1", status: "quarantined", on_hand: 3, quantity: 3, locations: ["Quarantine Area"], created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00" },
            ],
            total: 1,
            page: 1,
            pages: 1,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Quarantined Lots:")).toBeInTheDocument();
    expect(await screen.findByText("LOT-Q1")).toBeInTheDocument();
    expect(screen.getByText("Quarantine Area")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Release LOT-Q1"));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/10", { status: "in_stock" }));
  });

  it("moves a quarantined lot to a new location without releasing it", async () => {
    const product = makeProduct({ id: 5, sku: "SKU-5", name: "Widget", quarantined_qty: 3 });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { reference: "TRF-0001", outbound_id: 1, inbound_id: 2, movements: [] },
    });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/stock-movements/locations") {
        return Promise.resolve({ data: { locations: [], unallocated: 0 } });
      }
      if (url === "/products/5/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      if (url === "/lots") {
        return Promise.resolve({
          data: {
            items: [
              { id: 10, product_id: 5, lot_number: "LOT-Q1", status: "quarantined", on_hand: 3, quantity: 3, locations: ["Quarantine Area"], created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00" },
            ],
            total: 1,
            page: 1,
            pages: 1,
          },
        });
      }
      if (url === "/stock-movements/quarantined-locations") {
        return Promise.resolve({
          data: {
            locations: [
              { location_id: 1, path: "Quarantine Area", name: "Quarantine Area", quantity: 3, lots: [{ lot_id: 10, lot_number: "LOT-Q1", quantity: 3 }] },
            ],
          },
        });
      }
      if (url === "/locations") {
        return Promise.resolve({ data: { items: [{ id: 2, path: "Shelf B", is_active: true }], total: 1, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Move LOT-Q1" }));

    expect(await screen.findByText("Move Quarantined Stock: LOT-Q1")).toBeInTheDocument();
    expect(await screen.findByLabelText("Source Location")).toHaveValue("1");
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    await screen.findByRole("option", { name: "Shelf B" });
    fireEvent.change(screen.getByLabelText("Destination Location"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Quarantined Stock" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements/quarantined-move", {
        product_id: 5,
        quantity: 3,
        from_location_id: 1,
        to_location_id: 2,
        lot_id: 10,
        notes: "",
      })
    );
  });

  it("moves quarantined serialized stock by selecting serial numbers", async () => {
    const product = makeProduct({ id: 6, sku: "SKU-6", name: "Serial Widget", is_serialized: true, quarantined_qty: 2 });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { reference: "TRF-0002", outbound_id: 1, inbound_id: 2, movements: [] },
    });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/6/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      if (url === "/serial-numbers") {
        return Promise.resolve({
          data: {
            items: [
              { id: 1, product_id: 6, serial_number: "SN-Q1", lot_id: 10, location_id: 1, status: "quarantined", location_name: "Quarantine Area", sold_at: null, lot_number: "LOT-QS", lot_status: "quarantined", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
              { id: 2, product_id: 6, serial_number: "SN-Q2", lot_id: 10, location_id: 1, status: "quarantined", location_name: "Quarantine Area", sold_at: null, lot_number: "LOT-QS", lot_status: "quarantined", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
            ],
            total: 2,
            page: 1,
            pages: 1,
          },
        });
      }
      if (url === "/stock-movements/quarantined-locations") {
        return Promise.resolve({
          data: {
            locations: [
              { location_id: 1, path: "Quarantine Area", name: "Quarantine Area", quantity: 2, lots: [{ lot_id: 10, lot_number: "LOT-QS", quantity: 2 }] },
            ],
          },
        });
      }
      if (url === "/locations") {
        return Promise.resolve({ data: { items: [{ id: 2, path: "Shelf B", is_active: true }], total: 1, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Quarantined Serials:")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Move quarantined serials" }));

    expect(await screen.findByText("Move Quarantined Stock")).toBeInTheDocument();

    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    await screen.findByRole("option", { name: "Shelf B" });
    fireEvent.change(screen.getByLabelText("Destination Location"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Quarantined Stock" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements/quarantined-move", {
        product_id: 6,
        quantity: 2,
        from_location_id: 1,
        to_location_id: 2,
        serial_ids: [1, 2],
        notes: "",
      })
    );
  });

  it("lists quarantined serials and releases one back to stock", async () => {
    const product = makeProduct({ id: 6, sku: "SKU-6", name: "Serial Widget", is_serialized: true, quarantined_qty: 1 });
    (api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/products/6/trace") {
        return Promise.resolve({ data: { incoming: [], outgoing: [], work_orders: [] } });
      }
      if (url === "/serial-numbers") {
        return Promise.resolve({
          data: {
            items: [
              { id: 1, product_id: 6, serial_number: "SN-Q1", lot_id: 10, location_id: 1, status: "quarantined", location_name: "Quarantine Area", sold_at: null, lot_number: "LOT-QS", lot_status: "quarantined", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
            ],
            total: 1,
            page: 1,
            pages: 1,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<ProductDetail product={product} onClose={() => {}} />);

    expect(await screen.findByText("Quarantined Serials:")).toBeInTheDocument();
    expect(screen.getByText("SN-Q1")).toBeInTheDocument();
    expect(screen.getByText("(Lot LOT-QS)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Release SN-Q1" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/serial-numbers/1/status", { status: "in_stock" }));
  });
});
