import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Exceptions from "../pages/Exceptions";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockExceptions(data: Record<string, unknown> = {}) {
  getMock.mockImplementation((url: string) => {
    if (url === "/reports/exceptions") {
      return Promise.resolve({
        data: {
          summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 0, open_cycle_counts: 0, pending_asns: 0 },
          low_stock: [],
          zero_stock: [],
          quarantined_lots: [],
          open_cycle_counts: [],
          pending_asns: [],
          ...data,
        },
      });
    }
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Exceptions Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders section cards with summary counts", async () => {
    mockExceptions({
      summary: { low_stock: 3, zero_stock: 1, quarantined_lots: 2, open_cycle_counts: 4, pending_asns: 5 },
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Exceptions Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Low Stock")).toBeInTheDocument();
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
    expect(screen.getByText("Quarantined Lots")).toBeInTheDocument();
    expect(screen.getByText("Open Cycle Counts")).toBeInTheDocument();
    expect(screen.getByText("Pending ASNs")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows empty table states when all sections are empty", async () => {
    mockExceptions();
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Exceptions Dashboard")).toBeInTheDocument();
    expect(screen.getByText("No low stock items.")).toBeInTheDocument();
  });

  it("renders low stock rows from the response", async () => {
    mockExceptions({
      summary: { low_stock: 1, zero_stock: 0, quarantined_lots: 0, open_cycle_counts: 0, pending_asns: 0 },
      low_stock: [{ id: 1, name: "Widget", sku: "SKU-001", quantity: 4, reorder_level: 10, category: "Beverages", supplier: "Acme" }],
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("SKU-001")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
