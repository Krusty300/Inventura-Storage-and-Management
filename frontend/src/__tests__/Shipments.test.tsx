import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";
import Shipments from "../pages/Shipments";
import type { Shipment } from "../types";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

const baseShipment = (status: string): Shipment => ({
  id: 1,
  shipment_number: "SHP-100",
  customer_id: 1,
  status,
  carrier: "UPS",
  tracking_number: "",
  staging_location_id: null,
  sale_id: null,
  notes: "",
  ship_date: null,
  shipped_at: null,
  created_by: 1,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  customer_name: "Acme",
  username: "tester",
  invoice_number: "",
  payment_method: "",
  payment_provider: null,
  total_amount: 150,
  total_quantity: 3,
  total_picked: 0,
  items: [
    { id: 1, shipment_id: 1, product_id: 1, location_id: null, quantity_ordered: 3, quantity_picked: 0, quantity_packed: 0, quantity_shipped: 0, product_name: "Widget", location_name: "", is_serialized: false },
  ],
});

describe("Shipments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reflects draft -> picking -> packed status changes live in the detail modal", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: /View/ }));

    expect(await screen.findByRole("button", { name: "Pick" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pick" }));

    expect(await screen.findByRole("button", { name: "Pack" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Product Shipping" })).toBeInTheDocument();
    expect((await screen.findAllByText("picking")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Pack" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Pick" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Pack" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product Shipping" })).toBeInTheDocument();
    expect((await screen.findAllByText("packed")).length).toBeGreaterThan(0);
  });

  it("shows the shipped state and Create Invoice once the shipment ships", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      if (url === "/shipments/1/ship") { status = "shipped"; return Promise.resolve({}); }
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Product Shipping" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Product Shipping" })).not.toBeInTheDocument());
    expect((await screen.findAllByText("shipped")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: "Create Invoice" })).toBeInTheDocument();
  });

  it("sends the selected payment method when creating the invoice", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      if (url === "/shipments/1/ship") { status = "shipped"; return Promise.resolve({}); }
      if (url === "/shipments/1/create-sale") return Promise.resolve({ data: { invoice_number: "INV-1", payment_method: "card" } });
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Product Shipping" }));

    expect(await screen.findByRole("combobox", { name: "Payment method" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "card" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Invoice" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/shipments/1/create-sale", null, expect.objectContaining({
        params: expect.objectContaining({ payment_method: "card" }),
      }))
    );
  });

  it("sends the mobile money provider when creating the invoice", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      if (url === "/shipments/1/ship") { status = "shipped"; return Promise.resolve({}); }
      if (url === "/shipments/1/create-sale") return Promise.resolve({ data: { invoice_number: "INV-2", payment_method: "mobile_money", payment_provider: "airtel_money" } });
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Product Shipping" }));

    expect(await screen.findByRole("combobox", { name: "Payment method" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "mobile_money" } });
    expect(screen.getByRole("combobox", { name: "Mobile money provider" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Mobile money provider" }), { target: { value: "airtel_money" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Invoice" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/shipments/1/create-sale", null, expect.objectContaining({
        params: expect.objectContaining({ payment_method: "mobile_money", payment_provider: "airtel_money" }),
      }))
    );
  });

  it("prefills the provider from the customer's last mobile money sale and sends phone/reference", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      if (url === "/sales") return Promise.resolve({ data: { items: [{ payment_method: "mobile_money", payment_provider: "m-pesa" }], total: 1, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      if (url === "/shipments/1/ship") { status = "shipped"; return Promise.resolve({}); }
      if (url === "/shipments/1/create-sale") return Promise.resolve({ data: { invoice_number: "INV-3", payment_method: "mobile_money", payment_provider: "m-pesa" } });
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Product Shipping" }));

    fireEvent.change(await screen.findByRole("combobox", { name: "Payment method" }), { target: { value: "mobile_money" } });
    expect(screen.getByRole("combobox", { name: "Mobile money provider" })).toHaveValue("M-Pesa");
    fireEvent.change(screen.getByLabelText("Payer phone"), { target: { value: "0722 123 456" } });
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "SHP-REF-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Invoice" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/shipments/1/create-sale", null, expect.objectContaining({
        params: expect.objectContaining({
          payment_method: "mobile_money",
          payment_provider: "m-pesa",
          payment_reference: "SHP-REF-42",
          payment_phone: "0722 123 456",
        }),
      }))
    );
  });

  it("sends a debounced search query", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [baseShipment("draft")], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Shipments />);
    expect(await screen.findByText("SHP-100")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search shipments"), { target: { value: "SHP" } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/shipments", expect.objectContaining({ params: expect.objectContaining({ search: "SHP" }) }))
    );
  });

  it("sends the selected source location with each line item", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 0, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 0 } });
      if (url === "/products")
        return Promise.resolve({ data: { items: [{ id: 1, name: "Widget", sku: "SKU-1", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] }], total: 1, page: 1, pages: 1 } });
      if (url === "/customers") return Promise.resolve({ data: { items: [{ id: 5, name: "Acme" }], total: 1, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations")
        return Promise.resolve({ data: { locations: [
          { location_id: 10, path: "A", is_active: true, quantity: 3 },
          { location_id: 20, path: "B", is_active: true, quantity: 2 },
        ], unallocated: 0 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Shipments />);
    fireEvent.click(await screen.findByRole("button", { name: "New Shipment" }));
    const productCombobox = await screen.findByRole("combobox", { name: "Product" });
    fireEvent.click(productCombobox);
    fireEvent.click(await screen.findByRole("option", { name: "Widget (SKU-1)" }));
    await screen.findByRole("option", { name: "A (3)" }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("combobox", { name: "Source location" }));
    fireEvent.click(await screen.findByRole("option", { name: "A (3)" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Shipment" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/shipments", expect.objectContaining({
        items: [{ product_id: 1, quantity: 2, location_id: 10 }],
      }))
    );
  });

  it("opens a serial picker and sends the chosen serial_ids when picking serialized items", async () => {
    const serialized: Shipment = {
      ...baseShipment("draft"),
      items: [
        { id: 2, shipment_id: 1, product_id: 2, location_id: null, quantity_ordered: 2, quantity_picked: 0, quantity_packed: 0, quantity_shipped: 0, product_name: "Serial Widget", location_name: "", is_serialized: true },
      ],
    };
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [serialized], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: serialized });
      if (url === "/serial-numbers")
        return Promise.resolve({ data: { items: [
          { id: 11, product_id: 2, serial_number: "S-1", lot_id: null, location_id: null, lpn_id: null, status: "in_stock", sold_at: null, location_name: "", lot_number: "", lot_status: "in_stock", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
          { id: 12, product_id: 2, serial_number: "S-2", lot_id: null, location_id: null, lpn_id: null, status: "in_stock", sold_at: null, location_name: "", lot_number: "", lot_status: "in_stock", product_name: "Serial Widget", created_at: "2026-01-01T00:00:00" },
        ], total: 2, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") return Promise.resolve({ data: { ...serialized, status: "picking" } });
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);
    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));

    expect(await screen.findByText("Select Serial Numbers")).toBeInTheDocument();
    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "Pick Selected" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/shipments/1/pick", expect.objectContaining({
        items: [{ product_id: 2, serial_ids: [11, 12] }],
      }))
    );
  });

  it("shows a fulfillment status badge for serialized lines in the detail view", async () => {
    const serialized: Shipment = {
      ...baseShipment("draft"),
      items: [
        { id: 2, shipment_id: 1, product_id: 2, location_id: null, quantity_ordered: 2, quantity_picked: 0, quantity_packed: 0, quantity_shipped: 0, product_name: "Serial Widget", location_name: "", is_serialized: true },
      ],
    };
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [serialized], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: serialized });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<Shipments />);
    fireEvent.click(await screen.findByRole("button", { name: /View/ }));

    expect(await screen.findByText("serialized")).toBeInTheDocument();
    const pending = screen.getByText("pending");
    expect(pending).toHaveTextContent("pending");
    expect(pending.className).toContain("badge-neutral");
  });

  it("sends the selected status filter to the list endpoint", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [baseShipment("draft")], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Shipments />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Filter by status" }), { target: { value: "draft" } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/shipments", expect.objectContaining({ params: expect.objectContaining({ status: "draft" }) }))
    );
  });

  it("shows a status badge for draft and shipped shipments, and opens the detail when clicked", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments")
        return Promise.resolve({ data: { items: [baseShipment("draft"), { ...baseShipment("shipped"), id: 2, shipment_number: "SHP-200" }], total: 2, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment("draft") });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Shipments />);
    expect(await screen.findByText("draft")).toBeInTheDocument();
    expect(screen.getByText("shipped")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("View SHP-100"));
    expect(await screen.findByRole("button", { name: "Pick" })).toBeInTheDocument();
  });
});
