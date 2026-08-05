import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";
import Shipments from "../pages/Shipments";
import type { Shipment } from "../types";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

const baseShipment = (status: string): Shipment => ({
  id: 1,
  shipment_number: "SHP-100",
  customer_id: 1,
  status,
  carrier: "UPS",
  tracking_number: "",
  staging_location_id: null,
  sale_id: null,
  notes: "",
  ship_date: null,
  shipped_at: null,
  created_by: 1,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  customer_name: "Acme",
  username: "tester",
  invoice_number: "",
  total_amount: 150,
  total_quantity: 3,
  total_picked: 0,
  items: [
    { id: 1, shipment_id: 1, product_id: 1, quantity_ordered: 3, quantity_picked: 0, quantity_packed: 0, quantity_shipped: 0, product_name: "Widget", is_serialized: false },
  ],
});

describe("Shipments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reflects draft -> picking -> packed status changes live in the detail modal", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: "View" }));

    expect(await screen.findByRole("button", { name: "Pick" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pack" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pick" }));

    expect(await screen.findByRole("button", { name: "Pack" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ship" })).toBeInTheDocument();
    expect((await screen.findAllByText("picking")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Pack" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Pick" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Pack" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ship" })).toBeInTheDocument();
    expect((await screen.findAllByText("packed")).length).toBeGreaterThan(0);
  });

  it("shows the shipped state and Create Invoice once the shipment ships", async () => {
    let status = "draft";
    getMock.mockImplementation((url: string) => {
      if (url === "/shipments") return Promise.resolve({ data: { items: [{ ...baseShipment(status) }], total: 1, page: 1, pages: 1 } });
      if (url === "/shipments/stats") return Promise.resolve({ data: { counts: { draft: 1, picking: 0, packed: 0, shipped: 0, cancelled: 0 }, open: 1 } });
      if (url === "/shipments/1") return Promise.resolve({ data: baseShipment(status) });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    postMock.mockImplementation((url: string) => {
      if (url === "/shipments/1/pick") { status = "picking"; return Promise.resolve({}); }
      if (url === "/shipments/1/pack") { status = "packed"; return Promise.resolve({}); }
      if (url === "/shipments/1/ship") { status = "shipped"; return Promise.resolve({}); }
      return Promise.reject(new Error(`Unexpected post: ${url}`));
    });

    renderWithProviders(<Shipments />);

    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ship" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Ship" })).not.toBeInTheDocument());
    expect((await screen.findAllByText("shipped")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: "Create Invoice" })).toBeInTheDocument();
  });
});
