import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, makeProduct, makeVariant } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import SaleForm from "../components/SaleForm";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

const LOCATIONS = [
  { location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] },
  { location_id: 2, path: "Store B", is_active: true, quantity: 8, lots: [] },
];

function mockCatalog(products: ReturnType<typeof makeProduct>[], qcs: any[] = [], locations: any[] = LOCATIONS) {
  getMock.mockImplementation((url: string) => {
    if (url === "/customers") return Promise.resolve({ data: { items: [] } });
    if (url === "/products") return Promise.resolve({ data: { items: products } });
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD", tax_rate: 10 } });
    if (url === "/quality-checks") return Promise.resolve({ data: { items: qcs, total: qcs.length, page: 1, pages: 1 } });
    if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations, unallocated: 0 } });
    if (url === "/promotions") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/sales-channels/all") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("SaleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("adds a product from the catalog and completes the sale", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    const tile = await screen.findByRole("button", { name: /Widget/ });
    fireEvent.click(tile);
    expect(screen.getByLabelText("Quantity for Widget")).toHaveValue(1);
    await screen.findByText(/Tax \(10%\)/);
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      customer_id: null,
      discount_amount: 0,
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: null }],
    })));
  });

  it("loads customer names into the customer dropdown", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Corp", phone: "", email: "", address: "", customer_type: "wholesale", notes: "", is_active: true, created_at: "", updated_at: "" }] } });
      if (url === "/products") return Promise.resolve({ data: { items: [] } });
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/promotions") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/sales-channels/all") return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: "Acme Corp" })).toBeInTheDocument();
    const customerSelect = screen.getByLabelText("Customer");
    fireEvent.change(customerSelect, { target: { value: "1" } });
    expect(customerSelect).toHaveValue("Acme Corp");
  });

  it("blocks submission when the cart is empty", async () => {
    mockCatalog([]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    const submit = await screen.findByRole("button", { name: /Complete Sale/ });
    fireEvent.click(submit);
    expect(await screen.findByText(/Add at least one item to the sale/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("excludes serialized products from the catalog", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    const serialized = makeProduct({ id: 8, name: "Serial Gadget", sku: "SKU-8", is_serialized: true });
    mockCatalog([widget, serialized]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("button", { name: /Widget/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Serial Gadget/ })).not.toBeInTheDocument();
  });

  it("shows variants instead of a parent product with variants", async () => {
    const parent = makeProduct({ id: 7, name: "Shirt", sku: "SKU-7", unit_price: 10 });
    const red = makeVariant(parent, { id: 8, display_name: "Shirt - Red", unit_price: 12 });
    parent.variants = [{ ...red }];
    mockCatalog([parent]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("button", { name: /Shirt - Red/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Shirt\s(?!-)/ })).not.toBeInTheDocument();
  });

  it("filters the catalog by search", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    const gadget = makeProduct({ id: 9, name: "Gadget", sku: "SKU-9", unit_price: 15 });
    mockCatalog([widget, gadget]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    await screen.findByRole("button", { name: /Widget/ });
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "SKU-9" } });
    expect(await screen.findByRole("button", { name: /Gadget/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Widget/ })).not.toBeInTheDocument();
  });

  it("filters the catalog by category", async () => {
    const phone = makeProduct({ id: 7, name: "Phone", sku: "SKU-7", category_name: "Electronics" });
    const hammer = makeProduct({ id: 9, name: "Hammer", sku: "SKU-9", category_name: "Tools" });
    mockCatalog([phone, hammer]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    await screen.findByRole("button", { name: /Phone/ });
    fireEvent.click(screen.getByRole("button", { name: "Electronics" }));
    expect(await screen.findByRole("button", { name: /Phone/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hammer/ })).not.toBeInTheDocument();
  });

  it("lists stock locations in the cart line and sends the selected location", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    const locationSelect = screen.getByLabelText("Fulfill from location");
    expect(await screen.findByRole("option", { name: /Warehouse A \(12\)/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Store B \(8\)/ })).toBeInTheDocument();
    fireEvent.change(locationSelect, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: 2 }],
    })));
  });

  it("increases quantity with the stepper", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.click(screen.getByLabelText("Increase quantity"));
    expect(screen.getByLabelText("Quantity for Widget")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 7, quantity: 2, unit_price: 10, location_id: null }],
    })));
  });

  it("applies a discount to the sale", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Discount amount"), { target: { value: "2" } });
    expect(await screen.findByText("$8.80")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      discount_amount: 2,
    })));
  });

  it("blocks a discount larger than the subtotal", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Discount amount"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    expect(await screen.findByText(/Discount cannot exceed the subtotal/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("shows cash change and submits when sufficient", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Cash received"), { target: { value: "20" } });
    expect(await screen.findByText("Change $9.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      payment_method: "cash",
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: null }],
    })));
  });

  it("submits a mobile money provider with the sale", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "mobile_money" } });
    expect(screen.getByRole("combobox", { name: "Mobile money provider" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Mobile money provider" }), { target: { value: "t-kash" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      payment_method: "mobile_money",
      payment_provider: "t-kash",
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: null }],
    })));
  });

  it("submits payer phone and payment reference for mobile money", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "mobile_money" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Mobile money provider" }), { target: { value: "m-pesa" } });
    expect(screen.getByLabelText("Payer phone")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Payer phone"), { target: { value: "0722 100 100" } });
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "TX-REF-9" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      payment_method: "mobile_money",
      payment_provider: "m-pesa",
      payment_phone: "0722 100 100",
      payment_reference: "TX-REF-9",
    })));
  });

  it("blocks submission when cash received is less than the total", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Cash received"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    expect(await screen.findByText(/Amount received is less than the total/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("warns and blocks a product with a pending quality check", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget], [{
      id: 1, qc_number: "QC-1", product_id: 7, lot_id: null, location_id: null,
      work_order_id: null, batch_number: "", result: "pending", notes: "",
      checked_by: 1, checked_at: null, created_at: "", product_name: "Widget",
      lot_number: "", location_name: "", wo_number: "", checker_username: "",
    }]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    const tile = await screen.findByRole("button", { name: /Widget/ });
    fireEvent.click(tile);
    expect(await screen.findByText(/quality check and can't be sold yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    expect(postMock).not.toHaveBeenCalled();
  });

  it("allows adding a product with a location-scoped quality check and blocks it until an unaffected location is chosen", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget], [{
      id: 1, qc_number: "QC-1", product_id: 7, lot_id: null, location_id: 1,
      work_order_id: null, batch_number: "", result: "fail", notes: "",
      checked_by: 1, checked_at: null, created_at: "", product_name: "Widget",
      lot_number: "", location_name: "Warehouse A", wo_number: "", checker_username: "",
    }]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    // a location-scoped QC must not block adding the product to the cart
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    expect(screen.getByLabelText("Quantity for Widget")).toHaveValue(1);
    // with no (auto) location chosen the line item is blocked and guides the user
    expect(await screen.findByText(/choose a different location or resolve the QC/)).toBeInTheDocument();
    // choosing an unaffected location clears the block
    await screen.findByRole("option", { name: /Store B \(8\)/ });
    fireEvent.change(screen.getByLabelText("Fulfill from location"), { target: { value: "2" } });
    expect(screen.queryByText(/choose a different location or resolve the QC/)).not.toBeInTheDocument();
  });

  it("allows a sale when the pending quality check belongs to a different product", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget], [{
      id: 2, qc_number: "QC-2", product_id: 99, lot_id: null, location_id: null,
      work_order_id: null, batch_number: "", result: "pending", notes: "",
      checked_by: 1, checked_at: null, created_at: "", product_name: "Other",
      lot_number: "", location_name: "", wo_number: "", checker_username: "",
    }]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: null }],
    })));
  });

  it("warns and blocks submission when a line item exceeds available stock", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget], [], [{ location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] }]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Quantity for Widget"), { target: { value: "99" } });
    expect(await screen.findByText(/Only 12 total available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    expect(await screen.findByText(/exceed the available stock/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("keeps the applied promo code and discount when switching carts", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockImplementation((url: string) => {
      if (url === "/promotions/validate") return Promise.resolve({ data: { valid: true, discount_amount: 2 } });
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Promo code"), { target: { value: "SAVE10" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/Promo \(SAVE10\)/)).toBeInTheDocument();
    // moving to a new cart and back must restore the per-cart promo
    fireEvent.click(screen.getByRole("button", { name: "New cart" }));
    fireEvent.click(screen.getByRole("tab", { name: /Cart 1/ }));
    expect(screen.getByLabelText("Promo code")).toHaveValue("SAVE10");
    expect(screen.getByText(/Promo \(SAVE10\)/)).toBeInTheDocument();
  });

  it("keeps the payer phone on the STK screen and clears it on dismiss", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "mobile_money" } });
    fireEvent.change(screen.getByLabelText("Payer phone"), { target: { value: "0722 100 100" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    // the STK screen must still show the phone so the push can be sent/retried
    await screen.findByRole("button", { name: /Send STK Push/ });
    expect(screen.getByLabelText("STK push phone number")).toHaveValue("0722 100 100");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.queryByRole("button", { name: /Send STK Push/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/Cart is empty/)).toBeInTheDocument();
  });

  it("persists the latest edits when the form is locked", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    mockCatalog([widget]);
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    // lock immediately, before the 400ms autosave can run
    fireEvent.change(screen.getByLabelText("Discount amount"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Lock form" }));
    const stored = JSON.parse(localStorage.getItem("multiCartV1")!);
    expect(stored.carts[0].draft.discount).toBe("3");
    expect(stored.carts[0].draft.items).toHaveLength(1);
  });

  it("deletes a specific cart when multiple carts exist", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    const hammer = makeProduct({ id: 9, name: "Hammer", sku: "SKU-9", unit_price: 15 });
    mockCatalog([widget, hammer]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    // cart 1 holds a widget; cart 2 holds a hammer
    fireEvent.click(await screen.findByRole("button", { name: /Widget/ }));
    fireEvent.click(screen.getByRole("button", { name: "New cart" }));
    fireEvent.click(await screen.findByRole("button", { name: /Hammer/ }));
    // delete the non-active cart (cart 1) via its X button + confirm
    fireEvent.click(screen.getByRole("button", { name: "Delete Cart 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("tab", { name: /Cart 1/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Cart 2/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete Cart 1/ })).not.toBeInTheDocument();
    // the active cart's contents are untouched
    expect(screen.getByLabelText("Quantity for Hammer")).toHaveValue(1);
    // deleting the last remaining cart resets to a fresh empty cart
    fireEvent.click(screen.getByRole("button", { name: "Delete Cart 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText(/Cart is empty/);
    expect(screen.getByRole("tab", { name: /Cart 1/ })).toBeInTheDocument();
  });
});
