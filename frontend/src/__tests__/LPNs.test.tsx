import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

  it("shows LPN activity movements in the detail view", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/lpns") return Promise.resolve({ data: { items: [mockLPN()], total: 1, page: 1, pages: 1 } });
      if (url === "/lpns/1") return Promise.resolve({ data: mockLPN() });
      if (url === "/lpns/1/movements")
        return Promise.resolve({ data: [
          { id: 1, product_id: 1, user_id: 1, quantity_change: 5, movement_type: "receive", reference: "RCPT-0001", notes: "", created_at: "2026-01-01T10:00:00", product_name: "Widget", username: "tester", reference_type: "receipt", transfer_id: null, from_location_id: null, to_location_id: 2, from_location_name: "", to_location_name: "Aisle A", lot_id: null, serial_id: null },
          { id: 2, product_id: 1, user_id: 1, quantity_change: -1, movement_type: "transfer_out", reference: "MOV-0001", notes: "", created_at: "2026-01-02T10:00:00", product_name: "Widget", username: "tester", reference_type: "lpn_move", transfer_id: 3, from_location_id: 2, to_location_id: 3, from_location_name: "Aisle A", to_location_name: "Aisle B", lot_id: null, serial_id: null },
          { id: 3, product_id: 1, user_id: 1, quantity_change: 1, movement_type: "transfer_in", reference: "MOV-0001", notes: "", created_at: "2026-01-02T10:00:00", product_name: "Widget", username: "tester", reference_type: "lpn_move", transfer_id: 2, from_location_id: 2, to_location_id: 3, from_location_name: "Aisle A", to_location_name: "Aisle B", lot_id: null, serial_id: null },
        ] });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<LPNs />);
    fireEvent.click(await screen.findByLabelText("View LPN-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));

    expect(await screen.findByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Moved into location")).toBeInTheDocument();
    expect(screen.getByText("Moved to location")).toBeInTheDocument();
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(screen.getAllByText("MOV-0001").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Aisle A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Aisle B/).length).toBeGreaterThan(0);
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

  it("loads stock into an LPN from the detail view", async () => {
    const postMock = api.post as ReturnType<typeof vi.fn>;
    postMock.mockResolvedValue({ data: {} });
    getMock.mockImplementation((url: string) => {
      if (url === "/lpns") return Promise.resolve({ data: { items: [mockLPN({ contents: [] })], total: 1, page: 1, pages: 1 } });
      if (url === "/lpns/1") return Promise.resolve({ data: mockLPN({ contents: [] }) });
      if (url === "/products") return Promise.resolve({ data: { items: [{ id: 1, sku: "W", name: "Widget", display_name: "Widget", is_active: true, is_serialized: false, is_variant: false, parent_id: null, location_id: 2 }] } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 2, name: "Aisle A", path: "Aisle A", is_active: true }] } });
      if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: [{ location_id: 2, path: "Aisle A", is_active: true, quantity: 5, lots: [] }] } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });

    renderWithProviders(<LPNs />);
    fireEvent.click(await screen.findByLabelText("View LPN-0001"));
    fireEvent.click(await screen.findByRole("button", { name: "Load Stock" }));

    await screen.findByRole("option", { name: "Widget (W)" });
    const productSelect = screen.getAllByRole("combobox").find((c) =>
      c.querySelector('option[value="1"]')
    )!;
    fireEvent.change(productSelect, { target: { value: "1" } });
    expect(productSelect).toHaveValue("1");
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Load Stock" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/lpns/1/items", expect.objectContaining({
      product_id: 1,
      quantity: 3,
      from_location_id: 2,
      lot_id: null,
    })));
  });
});
