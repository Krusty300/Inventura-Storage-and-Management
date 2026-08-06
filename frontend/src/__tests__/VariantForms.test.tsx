import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, makeProduct, makeVariant } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import ReceiptForm from "../components/ReceiptForm";
import TransferModal from "../components/TransferModal";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockGet({ products, locations, stockLocations = [] }: { products: unknown[]; locations: unknown[]; stockLocations?: unknown[] }) {
  getMock.mockImplementation((url: string) => {
    if (url === "/products") return Promise.resolve({ data: { items: products, total: products.length, page: 1, pages: 1 } });
    if (url === "/locations") return Promise.resolve({ data: { items: locations, total: locations.length, page: 1, pages: 1 } });
    if (url === "/suppliers") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/lpns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/lots") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: stockLocations, unallocated: 0 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Variant-aware product selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("ReceiptForm lists variants instead of the variant parent", async () => {
    const parent = makeProduct({ id: 1, name: "Shirt" });
    const variant = makeVariant(parent, { id: 2 });
    const standalone = makeProduct({ id: 3, name: "Plain Widget" });
    mockGet({
      products: [{ ...parent, variants: [variant] }, standalone],
      locations: [],
    });

    renderWithProviders(<ReceiptForm onClose={() => {}} onSaved={() => {}} />);

    expect(await screen.findByRole("option", { name: "Shirt - Red (SKU-2)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Plain Widget (SKU-3)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Shirt (SKU-1)" })).not.toBeInTheDocument();
  });

  it("TransferModal lists variants instead of the variant parent", async () => {
    const parent = makeProduct({ id: 1, name: "Shirt" });
    const variant = makeVariant(parent, { id: 2 });
    mockGet({
      products: [{ ...parent, variants: [variant] }],
      locations: [{ id: 10, path: "A-01", is_active: true }],
    });

    renderWithProviders(<TransferModal onClose={() => {}} onSaved={() => {}} />);

    expect(await screen.findByRole("option", { name: "Shirt - Red (SKU-2)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Shirt (SKU-1)" })).not.toBeInTheDocument();
  });

  it("TransferModal auto-loads the product's stock locations into From Location", async () => {
    const parent = makeProduct({ id: 1, name: "Shirt" });
    const variant = makeVariant(parent, { id: 2 });
    mockGet({
      products: [{ ...parent, variants: [variant] }],
      locations: [
        { id: 10, path: "A-01", is_active: true },
        { id: 11, path: "B-01", is_active: true },
      ],
      stockLocations: [
        { location_id: 10, path: "A-01", is_active: true, quantity: 25, lots: [{ lot_id: 5, lot_number: "LOT-1", quantity: 25 }] },
      ],
    });

    renderWithProviders(<TransferModal onClose={() => {}} onSaved={() => {}} />);
    await screen.findByRole("option", { name: "Shirt - Red (SKU-2)" });

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: String(variant.id) } });

    expect(await screen.findByRole("option", { name: "A-01 (25 on hand)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "B-01 (25 on hand)" })).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "10" } });
    expect(screen.getByText("25 available at A-01")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "LOT-1 (25)" })).toBeInTheDocument();
  });

  it("TransferModal warns and blocks when the product has no stock anywhere", async () => {
    const parent = makeProduct({ id: 1, name: "Shirt" });
    const variant = makeVariant(parent, { id: 2 });
    mockGet({
      products: [{ ...parent, variants: [variant] }],
      locations: [{ id: 10, path: "A-01", is_active: true }],
      stockLocations: [],
    });

    renderWithProviders(<TransferModal onClose={() => {}} onSaved={() => {}} />);
    await screen.findByRole("option", { name: "Shirt - Red (SKU-2)" });

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: String(variant.id) } });

    expect(await screen.findByText(/This product has no stock at any location yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer Stock" })).toBeDisabled();
  });
});
