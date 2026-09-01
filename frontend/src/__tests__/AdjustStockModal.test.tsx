import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, makeProduct } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import AdjustStockModal from "../components/AdjustStockModal";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockApi(locations: { id: number; path: string; is_active: boolean }[], stocked: { location_id: number; path: string; quantity: number }[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/locations") return Promise.resolve({ data: { items: locations, total: locations.length, page: 1, pages: 1 } });
    if (url === "/stock-movements/locations")
      return Promise.resolve({ data: { locations: stocked.map((s) => ({ ...s, is_active: true, lots: [] })), unallocated: 0 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("AdjustStockModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("submits the chosen location when adjusting against its stock count", async () => {
    mockApi(
      [
        { id: 1, path: "Main", is_active: true },
        { id: 10, path: "Shelf A", is_active: true },
      ],
      [
        { location_id: 1, path: "Main", quantity: 2 },
        { location_id: 10, path: "Shelf A", quantity: 8 },
      ]
    );
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    renderWithProviders(<AdjustStockModal product={makeProduct({ id: 5, name: "Widget", sku: "W-5" })} onClose={() => {}} onAdjusted={() => {}} />);

    await screen.findByRole("heading", { name: "Adjust Stock" });
    await screen.findByRole("option", { name: "Shelf A (8)" });

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "10" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });

    expect(screen.getByText("Will remove 3 units")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Adjust Stock" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements/adjust", {
        product_id: 5,
        new_quantity: 5,
        reason_code: "recount",
        notes: "",
        location_id: 10,
      })
    );
  });

  it("submits a null location_id when the product has no located stock", async () => {
    mockApi([{ id: 1, path: "Main", is_active: true }], []);
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    renderWithProviders(<AdjustStockModal product={makeProduct({ id: 5, name: "Widget", sku: "W-5" })} onClose={() => {}} onAdjusted={() => {}} />);

    await screen.findByRole("heading", { name: "Adjust Stock" });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } });

    expect(screen.getByText("Will add 10 units")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Adjust Stock" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/stock-movements/adjust", {
        product_id: 5,
        new_quantity: 30,
        reason_code: "recount",
        notes: "",
        location_id: null,
      })
    );
  });

  it("auto-detects and preselects the location holding the most existing stock", async () => {
    mockApi(
      [
        { id: 1, path: "Main", is_active: true },
        { id: 10, path: "Shelf A", is_active: true },
        { id: 3, path: "Bin B", is_active: true },
      ],
      [
        { location_id: 1, path: "Main", quantity: 2 },
        { location_id: 10, path: "Shelf A", quantity: 8 },
        { location_id: 3, path: "Bin B", quantity: 5 },
      ]
    );
    renderWithProviders(<AdjustStockModal product={makeProduct({ id: 5, name: "Widget", sku: "W-5" })} onClose={() => {}} onAdjusted={() => {}} />);

    await screen.findByRole("heading", { name: "Adjust Stock" });
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toHaveValue("10"));

    expect(screen.getByText(/Auto-detected from existing stock/)).toBeInTheDocument();
    // The "New Quantity" is synced to the selected location's on-hand (8), so
    // there is no accidental delta and the adjust button stays disabled.
    expect(screen.getByRole("spinbutton")).toHaveValue(8);
    expect(screen.getByRole("button", { name: "Adjust Stock" })).toBeDisabled();
  });

  it("shows the selected location's on-hand as the current quantity", async () => {
    mockApi(
      [{ id: 1, path: "Main", is_active: true }],
      [{ location_id: 1, path: "Main", quantity: 2 }]
    );
    renderWithProviders(<AdjustStockModal product={makeProduct({ id: 5, name: "Widget", sku: "W-5" })} onClose={() => {}} onAdjusted={() => {}} />);

    await screen.findByRole("heading", { name: "Adjust Stock" });
    await screen.findByRole("option", { name: "Main (2)" });

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "1" } });

    // Selecting a location syncs the new-quantity field to its on-hand count,
    // so new/current are computed against the same (per-location) scope.
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
    expect(screen.getByText("Current Quantity", { exact: false })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    expect(screen.getByText("Will add 3 units")).toBeInTheDocument();
  });
});
