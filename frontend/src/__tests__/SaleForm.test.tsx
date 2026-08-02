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
      items: [{ product_id: 7, quantity: 3, unit_price: 10 }],
    })));
  });

  it("loads customer names into the customer dropdown", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/customers") return Promise.resolve({ data: { items: [{ id: 1, name: "Acme Corp", phone: "", email: "", address: "", customer_type: "wholesale", notes: "", is_active: true, created_at: "", updated_at: "" }] } });
      if (url === "/products") return Promise.resolve({ data: { items: [] } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", tax_rate: 10 } });
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
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SaleForm onClose={() => {}} onSaved={() => {}} />);
    const submit = await screen.findByRole("button", { name: /Complete Sale/ });
    fireEvent.click(submit);
    await vi.waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });
});
