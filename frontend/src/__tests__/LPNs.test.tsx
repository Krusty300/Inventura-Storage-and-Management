import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import LPNs from "../pages/LPNs";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockLPN(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    lpn_number: "LPN-0001",
    lpn_type: "pallet",
    location_id: 2,
    status: "active",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    location_name: "Aisle A",
    content_count: 2,
    total_quantity: 5,
    contents: [],
    serials: [],
    ...overrides,
  };
}

function mockLPNs(items: ReturnType<typeof mockLPN>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/lpns") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("LPNs Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders LPN rows with details from the API", async () => {
    mockLPNs([mockLPN()]);
    renderWithProviders(<LPNs />);
    expect(await screen.findByText("LPN-0001")).toBeInTheDocument();
    expect(screen.getByText("pallet")).toBeInTheDocument();
    expect(screen.getByText("Aisle A")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockLPNs([mockLPN()]);
    renderWithProviders(<LPNs />);
    expect(await screen.findByText("LPN-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create LPN" })).toBeInTheDocument();
    expect(screen.getByLabelText("View LPN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Print label LPN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Move LPN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete LPN-0001")).toBeInTheDocument();
  });

  it("hides admin actions for workers", async () => {
    mockLPNs([mockLPN()]);
    renderWithProviders(<LPNs />, { role: "worker" });
    expect(await screen.findByText("LPN-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create LPN" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Move LPN-0001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete LPN-0001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("View LPN-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Print label LPN-0001")).toBeInTheDocument();
  });

  it("shows empty state when no LPNs", async () => {
    mockLPNs([]);
    renderWithProviders(<LPNs />);
    expect(await screen.findByText("No LPNs yet")).toBeInTheDocument();
  });

  it("shows both products and serialized items in the detail view", async () => {
    mockLPNs([mockLPN({
      contents: [{ product_id: 1, product_name: "Widget", lot_id: null, lot_number: "", quantity: 7 }],
      serials: [
        { serial_id: 1, product_id: 2, product_name: "Serial Gadget", serial_number: "SN-001", lot_number: "", status: "in_stock", location_name: "Aisle A" },
        { serial_id: 2, product_id: 2, product_name: "Serial Gadget", serial_number: "SN-002", lot_number: "LOT-X", status: "in_stock", location_name: "Aisle A" },
      ],
    })]);
    renderWithProviders(<LPNs />);
    fireEvent.click(await screen.findByLabelText("View LPN-0001"));

    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Serialized Items")).toBeInTheDocument();
    expect(screen.getByText("SN-001")).toBeInTheDocument();
    expect(screen.getByText("SN-002")).toBeInTheDocument();
    expect(screen.getByText("LOT-X")).toBeInTheDocument();
  });

  it("opens the confirm dialog and deletes an LPN", async () => {
    mockLPNs([mockLPN()]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<LPNs />);
    fireEvent.click(await screen.findByLabelText("Delete LPN-0001"));
    expect(screen.getByText(/Are you sure you want to delete "LPN-0001"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("LPN deleted")).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledWith("/lpns/1");
  });
});
