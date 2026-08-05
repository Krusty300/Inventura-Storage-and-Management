import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, makeProduct } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import ProductForm from "../components/ProductForm";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

describe("ProductForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("creates a product on submit", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [{ id: 1, name: "Beverages" }] } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 5, code: "A-01-B", name: "Bin A-01-B", path: "A-01-B", is_active: true }] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: { id: 99 } });
    renderWithProviders(<ProductForm product={null} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Add Product" })).toBeInTheDocument();
    const [skuInput, nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(skuInput, { target: { value: "SKU-99" } });
    fireEvent.change(nameInput, { target: { value: "Gadget" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "A-01-B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/products", expect.objectContaining({ sku: "SKU-99", name: "Gadget" })));
  });

  it("rejects creating a product without a location", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [] } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: { id: 99 } });
    renderWithProviders(<ProductForm product={null} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Add Product" })).toBeInTheDocument();
    const [skuInput, nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(skuInput, { target: { value: "SKU-NOLOC" } });
    fireEvent.change(nameInput, { target: { value: "No Loc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/Every product must be assigned to an active location/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("updates an existing product on submit", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [] } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<ProductForm product={makeProduct({ id: 3, name: "Widget", sku: "SKU-3", location_id: 12 })} onClose={() => {}} onSaved={() => {}} />);
    const nameInput = await screen.findByDisplayValue("Widget");
    fireEvent.change(nameInput, { target: { value: "Widget Pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/products/3", expect.objectContaining({ name: "Widget Pro", sku: "SKU-3" })));
  });

  it("resolves the LocationPicker path to location_id on create", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [] } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 7, code: "A-01-B", name: "Bin A-01-B", path: "A-01-B", is_active: true }] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: { id: 99 } });
    renderWithProviders(<ProductForm product={null} onClose={() => {}} onSaved={() => {}} />);
    await screen.findByRole("heading", { name: "Add Product" });
    const [skuInput, nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(skuInput, { target: { value: "SKU-77" } });
    fireEvent.change(nameInput, { target: { value: "Gadget" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "A-01-B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/products", expect.objectContaining({ location_id: 7 })));
  });

  it("keeps the existing location_id when editing without touching the location field", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/categories") return Promise.resolve({ data: { items: [] } });
      if (url === "/suppliers") return Promise.resolve({ data: { items: [] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<ProductForm product={makeProduct({ id: 4, name: "Widget", sku: "SKU-4", location_id: 12, location: "" })} onClose={() => {}} onSaved={() => {}} />);
    const nameInput = await screen.findByDisplayValue("Widget");
    fireEvent.change(nameInput, { target: { value: "Widget X" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/products/4", expect.objectContaining({ location_id: 12 })));
  });
});
