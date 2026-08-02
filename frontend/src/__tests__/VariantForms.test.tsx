import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, makeProduct, makeVariant } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import ReceiptForm from "../components/ReceiptForm";
import TransferModal from "../components/TransferModal";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockGet({ products, locations }: { products: unknown[]; locations: unknown[] }) {
  getMock.mockImplementation((url: string) => {
    if (url === "/products") return Promise.resolve({ data: { items: products, total: products.length, page: 1, pages: 1 } });
    if (url === "/locations") return Promise.resolve({ data: { items: locations, total: locations.length, page: 1, pages: 1 } });
    if (url === "/suppliers") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/lpns") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/lots") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
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
});
