import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, makeProduct } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import SaleForm from "../components/SaleForm";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

describe("SaleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("submits a sale with the selected product", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [
        { location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] },
      ], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    const productSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(productSelect, { target: { value: "7" } });
    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 7, quantity: 3, unit_price: 10, location_id: null }],
    })));
  });

  it("loads customer names into the customer dropdown", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Corp", phone: "", email: "", address: "", customer_type: "wholesale", notes: "", is_active: true, created_at: "", updated_at: "" }] } });
      if (url === "/products") return Promise.resolve({ data: { items: [] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: "Acme Corp" })).toBeInTheDocument();
  });

  it("blocks submission when a line item has no product", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    const submit = await screen.findByRole("button", { name: /Complete Sale/ });
    fireEvent.click(submit);
    await vi.waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });

  it("excludes serialized products from the product dropdown", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    const serialized = makeProduct({ id: 8, name: "Serial Gadget", sku: "SKU-8", is_serialized: true });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget, serialized] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Serial Gadget/ })).not.toBeInTheDocument();
  });

  it("lists stock locations with on-hand counts and sends the selected location", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [
        { location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] },
        { location_id: 2, path: "Store B", is_active: true, quantity: 8, lots: [] },
      ], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    const productSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(productSelect, { target: { value: "7" } });
    expect(await screen.findByRole("option", { name: /Warehouse A \(12\)/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Store B \(8\)/ })).toBeInTheDocument();
    const locationSelect = screen.getAllByRole("combobox")[3];
    fireEvent.change(locationSelect, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: 2 }],
    })));
  });

  it("resets the location when the product changes", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    const gadget = makeProduct({ id: 9, name: "Gadget", sku: "SKU-9", unit_price: 15 });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget, gadget] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [
        { location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] },
      ], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    const productSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(productSelect, { target: { value: "7" } });
    await screen.findByRole("option", { name: /Warehouse A \(12\)/ });
    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "1" } });
    fireEvent.change(productSelect, { target: { value: "9" } });
    expect(screen.getAllByRole("combobox")[3]).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 9, quantity: 1, unit_price: 15, location_id: null }],
    })));
  });

  it("warns and blocks submission when the product has a pending quality check", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [{
        id: 1, qc_number: "QC-1", product_id: 7, lot_id: null, location_id: null,
        work_order_id: null, batch_number: "", result: "pending", notes: "",
        checked_by: 1, checked_at: null, created_at: "", product_name: "Widget",
        lot_number: "", location_name: "", wo_number: "", checker_username: "",
      }], total: 1, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    const productSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(productSelect, { target: { value: "7" } });
    expect(await screen.findByText(/pending quality check/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });

  it("allows a sale when the pending quality check belongs to a different product", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [{
        id: 2, qc_number: "QC-2", product_id: 99, lot_id: null, location_id: null,
        work_order_id: null, batch_number: "", result: "pending", notes: "",
        checked_by: 1, checked_at: null, created_at: "", product_name: "Other",
        lot_number: "", location_name: "", wo_number: "", checker_username: "",
      }], total: 1, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [
        { location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] },
      ], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    const productSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(productSelect, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/sales", expect.objectContaining({
      items: [{ product_id: 7, quantity: 1, unit_price: 10, location_id: null }],
    })));
  });

  it("warns and blocks submission when a line item exceeds available stock", async () => {
    const widget = makeProduct({ id: 7, name: "Widget", sku: "SKU-7", unit_price: 10 });
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      if (url === "/products") return Promise.resolve({ data: { items: [widget] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
      if (url === "/quality-checks") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [
        { location_id: 1, path: "Warehouse A", is_active: true, quantity: 12, lots: [] },
      ], unallocated: 0 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("option", { name: /Widget/ })).toBeInTheDocument();
    const productSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(productSelect, { target: { value: "7" } });
    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "99" } });
    expect(await screen.findByText(/Only 12 total available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Complete Sale/ }));
    await vi.waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });
});
