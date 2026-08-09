import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, makeProduct } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import StockMovementForm from "../components/StockMovementForm";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockProductApi(products: ReturnType<typeof makeProduct>[], locations: { id: number; path: string; is_active: boolean }[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/products") return Promise.resolve({ data: { items: products, total: products.length, page: 1, pages: 1 } });
    if (url === "/locations") return Promise.resolve({ data: { items: locations, total: locations.length, page: 1, pages: 1 } });
    if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [], unallocated: 0 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("StockMovementForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("hides the location picker until a product is selected", async () => {
    mockProductApi([makeProduct({ id: 5, name: "Widget", sku: "W-5" })], [{ id: 1, path: "Main", is_active: true }]);
    renderWithProviders(<StockMovementForm onClose={() => {}} onSaved={() => {}} />);

    expect(await screen.findByText("Record Stock Movement")).toBeInTheDocument();
    expect(screen.queryByText("Location *")).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "5" } });

    expect(await screen.findByText("Location *")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Main" })).toBeInTheDocument();
  });

  it("submits the chosen location for a stock in movement", async () => {
    mockProductApi([makeProduct({ id: 5, name: "Widget", sku: "W-5" })], [
      { id: 1, path: "Main", is_active: true },
      { id: 10, path: "Shelf A", is_active: true },
    ]);
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    renderWithProviders(<StockMovementForm onClose={() => {}} onSaved={() => {}} />);

    await screen.findByText("Record Stock Movement");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "5" } });

    await screen.findByRole("option", { name: "Shelf A" });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "10" } });
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements", {
        product_id: 5,
        quantity_change: 5,
        movement_type: "in",
        reference: "",
        notes: "",
        location_id: 10,
      })
    );
  });

  it("submits a negative quantity with the chosen source location for a stock out movement", async () => {
    mockProductApi([makeProduct({ id: 7, name: "Gadget", sku: "G-7" })], [
      { id: 1, path: "Main", is_active: true },
      { id: 20, path: "Bin B", is_active: true },
    ]);
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    renderWithProviders(<StockMovementForm onClose={() => {}} onSaved={() => {}} />);

    await screen.findByText("Record Stock Movement");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "7" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "out" } });

    await screen.findByRole("option", { name: "Bin B" });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "20" } });
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements", {
        product_id: 7,
        quantity_change: -3,
        movement_type: "out",
        reference: "",
        notes: "",
        location_id: 20,
      })
    );
  });

  it("does not show a location picker when editing a movement", async () => {
    mockProductApi([makeProduct({ id: 5, name: "Widget", sku: "W-5" })], [{ id: 1, path: "Main", is_active: true }]);
    renderWithProviders(
      <StockMovementForm
        movement={{ id: 3, product_id: 5, quantity_change: 5, movement_type: "in", reference: "PO-1", notes: "", created_at: "2026-01-01T00:00:00" } as never}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    expect(await screen.findByText("Edit Stock Movement")).toBeInTheDocument();
    expect(screen.queryByText("Location *")).not.toBeInTheDocument();
  });

  it("shows the auto-reference hint only for a Return movement", async () => {
    mockProductApi([makeProduct({ id: 5, name: "Widget", sku: "W-5" })], [{ id: 1, path: "Main", is_active: true }]);
    renderWithProviders(<StockMovementForm onClose={() => {}} onSaved={() => {}} />);

    await screen.findByText("Record Stock Movement");
    expect(screen.queryByText(/auto-generate a reference/)).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "return" } });

    expect(await screen.findByText("Leave blank to auto-generate a reference (RET-...).")).toBeInTheDocument();
  });
});
