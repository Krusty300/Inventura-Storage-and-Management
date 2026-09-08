import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
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
          summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 0, quarantined_serials: 0, quarantined_units: 0, open_cycle_counts: 0, pending_asns: 0, quality_checks: 0 },
          low_stock: [],
          zero_stock: [],
          quarantined_lots: [],
          quarantined_serials: [],
          open_cycle_counts: [],
          pending_asns: [],
          quality_checks: [],
          ...data
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
    expect(screen.getByText("No pending or failed quality checks.")).toBeInTheDocument();
  });

  it("renders pending and failed quality checks in the Quality Checks section", async () => {
    mockExceptions({
      summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 0, open_cycle_counts: 0, pending_asns: 0, quality_checks: 2 },
      quality_checks: [
        { id: 1, qc_number: "QC-001", product_id: 1, product_name: "Widget", location_id: null, location_name: "All locations", result: "fail", lot_number: "LOT-A", checked_at: "2026-01-01T00:00:00" },
        { id: 2, qc_number: "QC-002", product_id: 2, product_name: "Gadget", location_id: 3, location_name: "Main / Aisle 1", result: "pending", lot_number: "", checked_at: null },
      ],
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("QC-001")).toBeInTheDocument();
    expect(screen.getByText("QC-002")).toBeInTheDocument();
    expect(screen.getByText("All locations")).toBeInTheDocument();
    expect(screen.getByText("Main / Aisle 1")).toBeInTheDocument();
    expect(screen.getByText("fail")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("renders low stock rows from the response", async () => {
    mockExceptions({
      summary: { low_stock: 1, zero_stock: 0, quarantined_lots: 0, open_cycle_counts: 0, pending_asns: 0 },
      low_stock: [{ id: 1, name: "Widget", sku: "SKU-001", quantity: 4, reorder_level: 10, category: "Beverages", supplier: "Acme" }],
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Exceptions Dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Low Stock" }));
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("SKU-001")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("releases a quarantined lot via the Quarantined Lots section", async () => {
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: {} });
    mockExceptions({
      summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 1, open_cycle_counts: 0, pending_asns: 0 },
      quarantined_lots: [{
        id: 5, lot_number: "Q-LOT-1", product_id: 1, product_name: "Widget",
        on_hand: 12, expiry_date: null, received_date: "2026-01-15T00:00:00",
      }],
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Exceptions Dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Quarantined Lots" }));
    expect(await screen.findByText("Q-LOT-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Release/ }));
    expect(screen.getByRole("dialog", { name: "Release Quarantined Lot" })).toBeInTheDocument();
    expect(screen.getByText(/Release lot Q-LOT-1 back to sellable stock/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Release Lot" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/5", { status: "in_stock" }));
  });

  it("cancels releasing a quarantined lot", async () => {
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: {} });
    mockExceptions({
      summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 1, open_cycle_counts: 0, pending_asns: 0 },
      quarantined_lots: [{
        id: 5, lot_number: "Q-LOT-1", product_id: 1, product_name: "Widget",
        on_hand: 12, expiry_date: null, received_date: "2026-01-15T00:00:00",
      }],
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Exceptions Dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Quarantined Lots" }));
    expect(await screen.findByText("Q-LOT-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Release/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(putMock).not.toHaveBeenCalled();
  });

  it("lists quarantined serials (including no-lot ones) and releases from the section", async () => {
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: {} });
    mockExceptions({
      summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 0, quarantined_serials: 2, quarantined_units: 2, open_cycle_counts: 0, pending_asns: 0 },
      quarantined_serials: [
        { id: 11, serial_number: "Q-SER-1", product_id: 1, product_name: "Widget", lot_id: null, lot_number: "", location_name: "Quarantine Area" },
        { id: 12, serial_number: "Q-SER-2", product_id: 1, product_name: "Widget", lot_id: 5, lot_number: "Q-LOT-1", location_name: "" },
      ],
    });
    renderWithProviders(<Exceptions />);
    expect(await screen.findByText("Exceptions Dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Quarantined Serials" }));
    expect(await screen.findByText("Q-SER-1")).toBeInTheDocument();
    expect(screen.getByText("Q-SER-2")).toBeInTheDocument();
    expect(screen.getByText("Quarantine Area")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Release serial Q-SER-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Release Serial" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/serial-numbers/11/status", { status: "in_stock" }));
  });

  it("deep links to the Quarantined Lots section via ?section=", async () => {
    mockExceptions({
      summary: { low_stock: 0, zero_stock: 0, quarantined_lots: 1, quarantined_serials: 0, quarantined_units: 12, open_cycle_counts: 0, pending_asns: 0 },
      quarantined_lots: [{
        id: 5, lot_number: "Q-LOT-1", product_id: 1, product_name: "Widget",
        on_hand: 12, expiry_date: null, received_date: "2026-01-15T00:00:00",
      }],
    });
    renderWithProviders(<Exceptions />, { route: "/exceptions?section=quarantined_lots" });
    expect(await screen.findByText("Q-LOT-1")).toBeInTheDocument();
    expect(screen.getByText("12 units quarantined · 1 lots · 0 serials")).toBeInTheDocument();
  });
});
