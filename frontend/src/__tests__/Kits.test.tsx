import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";
import Kits from "../pages/Kits";
import type { Kit } from "../types";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

const baseKit = (overrides: Partial<Kit> = {}): Kit => ({
  id: 1,
  product_id: 1,
  name: "Starter Kit",
  description: "A bundle of essentials",
  version: "v1",
  discount_type: "fixed",
  discount_value: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  product_name: "Gift Set",
  item_count: 2,
  total_cost: 12,
  retail_value: 40,
  bundle_price: 35,
  savings: 5,
  items: [
    { id: 1, kit_id: 1, product_id: 2, quantity: 2, position: 0, product_name: "Widget", unit_cost: 4, unit_price: 10 },
    { id: 2, kit_id: 1, product_id: 3, quantity: 1, position: 1, product_name: "Gadget", unit_cost: 4, unit_price: 20 },
  ],
  ...overrides,
});

const mockProducts = [
  { id: 1, sku: "SKU-OUT", name: "Gift Set", display_name: "Gift Set", is_variant: false, variants: [], is_active: true, quantity: 0 },
  { id: 2, sku: "SKU-W", name: "Widget", display_name: "Widget", is_variant: false, variants: [], is_active: true, quantity: 10 },
  { id: 3, sku: "SKU-G", name: "Gadget", display_name: "Gadget", is_variant: false, variants: [], is_active: true, quantity: 10 },
];

describe("Kits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the kit list with pricing", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/kits") return Promise.resolve({ data: { items: [baseKit()], total: 1, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<Kits />);
    expect(await screen.findByText("Starter Kit")).toBeInTheDocument();
    expect(screen.getByText("Gift Set")).toBeInTheDocument();
    expect(screen.getAllByText(/\$35/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$40/).length).toBeGreaterThan(0);
  });

  it("opens the detail with components and assemble/disassemble controls", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/kits") return Promise.resolve({ data: { items: [baseKit()], total: 1, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 10, path: "Main", is_active: true }], total: 1, page: 1, pages: 1 } });
      if (url.startsWith("/costing/products/")) return Promise.resolve({ data: { unit_cost: 12, items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<Kits />);
    fireEvent.click(await screen.findByRole("button", { name: /View Starter Kit/ }));
    expect(await screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Gadget")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assemble" })).toBeInTheDocument();
    const disassemble = screen.getByRole("button", { name: /Disassemble/ });
    expect(disassemble).toBeInTheDocument();
  });

  it("assembles a kit from the detail modal", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/kits") return Promise.resolve({ data: { items: [baseKit()], total: 1, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 10, path: "Main", is_active: true }], total: 1, page: 1, pages: 1 } });
      if (url.startsWith("/costing/products/")) return Promise.resolve({ data: { unit_cost: 12, items: [] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: baseKit() });

    renderWithProviders(<Kits />);
    fireEvent.click(await screen.findByRole("button", { name: /View Starter Kit/ }));
    await screen.findByRole("button", { name: "Assemble" });
    fireEvent.click(screen.getByRole("button", { name: "Assemble" }));

    const qtyInput = await screen.findByLabelText("Quantity");
    fireEvent.change(qtyInput, { target: { value: "2" } });
    const locInput = screen.getByLabelText("Location");
    fireEvent.change(locInput, { target: { value: "Main" } });

    fireEvent.click(screen.getByRole("button", { name: "Assemble kit" }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/kits/1/assemble", { quantity: 2, location_id: 10 });
    });
    expect(await screen.findByText("Assembled 2 x 'Gift Set'")).toBeInTheDocument();
  });

  it("creates a new kit through the form", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/kits") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      if (url === "/products") return Promise.resolve({ data: { items: mockProducts, total: 3, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockResolvedValue({ data: baseKit() });

    renderWithProviders(<Kits />);
    fireEvent.click(await screen.findByRole("button", { name: "New Kit" }));
    expect(await screen.findByLabelText("Output product")).toBeInTheDocument();

    const outputBox = screen.getByLabelText("Output product");
    fireEvent.click(outputBox);
    const outputMenu = document.getElementById(outputBox.getAttribute("aria-controls")!)!;
    fireEvent.click(await within(outputMenu).findByRole("option", { name: /Gift Set \(SKU-OUT\)/ }));

    const compBox = screen.getAllByLabelText("Component product")[0];
    fireEvent.click(compBox);
    const compMenu = document.getElementById(compBox.getAttribute("aria-controls")!)!;
    fireEvent.click(await within(compMenu).findByRole("option", { name: /Widget \(SKU-W\)/ }));

    fireEvent.click(screen.getByRole("button", { name: "Save Kit" }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/kits", expect.objectContaining({
        product_id: 1,
        discount_type: "fixed",
        discount_value: 0,
        items: [expect.objectContaining({ product_id: 2, quantity: 1 })],
      }));
    });
  });

  it("deletes a kit after confirmation", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/kits") return Promise.resolve({ data: { items: [baseKit()], total: 1, page: 1, pages: 1 } });
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$", currency_code: "USD" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    deleteMock.mockResolvedValue({});

    renderWithProviders(<Kits />);
    fireEvent.click(await screen.findByRole("button", { name: /Delete Starter Kit/ }));
    expect(await screen.findByText("Delete Kit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/kits/1"));
  });
});