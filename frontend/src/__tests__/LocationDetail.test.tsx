import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";
import type { Location } from "../types";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import LocationDetail from "../components/LocationDetail";

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 5,
    code: "L-5",
    name: "Quarantine Area",
    path: "Aisle Q",
    parent_id: null,
    location_type: "quarantine",
    is_active: true,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    stock_line_count: 2,
    lpn_count: 0,
    lot_count: 1,
    serial_count: 0,
    total_quantity: 8,
    stock_value: 8,
    ...overrides,
  };
}

describe("LocationDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows quarantine and release quick actions per lot", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/locations/5/detail") {
        return Promise.resolve({
          data: {
            location: makeLocation(),
            stock_lines: [
              { id: 1, product_id: 1, product_name: "Widget", sku: "SKU-1", lot_number: "LOT-Q1", lot_id: 10, lot_status: "quarantined", lpn_number: "", quantity: 3, unit_cost: 1, value: 3 },
              { id: 2, product_id: 1, product_name: "Widget", sku: "SKU-1", lot_number: "LOT-S1", lot_id: 11, lot_status: "in_stock", lpn_number: "", quantity: 5, unit_cost: 1, value: 5 },
            ],
            lpns: [],
            serials: [],
            scrapped_serials: [],
            movements: [],
          },
        });
      }
      if (url === "/activity-logs") {
        return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<LocationDetail location={makeLocation()} onClose={() => {}} />);

    expect(await screen.findByText("LOT-Q1")).toBeInTheDocument();
    expect(screen.getByLabelText("Release LOT-Q1")).toBeInTheDocument();
    expect(screen.getByLabelText("Quarantine LOT-S1")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Release LOT-Q1"));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/10", { status: "in_stock" }));

    fireEvent.click(screen.getByLabelText("Quarantine LOT-S1"));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/11", { status: "quarantined" }));
  });
});
