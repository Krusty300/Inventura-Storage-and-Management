import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, pickDate, makeQueryClient } from "./testUtils";
import api from "../api/client";
import OrderDetail from "../components/OrderDetail";
import type { Order } from "../types";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

function makeOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: 1,
    order_number: "PO-1001",
    supplier_id: null,
    supplier_name: "Acme Supplies",
    user_id: 1,
    status: "approved",
    total_amount: 250,
    notes: "",
    expected_arrival: null,
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    received_at: null,
    approved_by: 1,
    approved_at: "2026-01-02T10:00:00",
    approver_name: "admin",
    username: "tester",
    items: [],
    ...overrides,
  };
}

describe("OrderDetail receive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getMock.mockImplementation((url: string, config?: any) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 5, path: "Main Warehouse" }] } });
      if (url === "/lpns") {
        const items = config?.params?.location_id ? [] : [{ id: 7, lpn_number: "LPN-1001" }];
        return Promise.resolve({ data: { items } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
  });

  it("shows a location picker and serial number inputs for serialized items when receiving", async () => {
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget SN", is_serialized: true }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    expect(screen.getByLabelText("Serial numbers for Widget SN")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter 2 serial number(s), one per line")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
  });

  it("sends serial numbers when receiving a serialized order", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget SN", is_serialized: true }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("Serial numbers for Widget SN"), { target: { value: "SN-001\nSN-002" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received", serial_numbers: { 10: ["SN-001", "SN-002"] } });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("does not submit when serial count is wrong", async () => {
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget SN", is_serialized: true }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("Serial numbers for Widget SN"), { target: { value: "SN-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => expect(putMock).not.toHaveBeenCalled());
  });

  it("receives a non-serialized order without a chosen location", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received" });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("sends the chosen location when receiving into a specific location", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    const queryClient = makeQueryClient();
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />, { queryClient });
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    await vi.waitFor(() => expect(queryClient.getQueryState(["locations", "order-picker"])?.status).toBe("success"));
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Main Warehouse" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received", receive_locations: { 10: 5 } });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("sends lot number and expiry date when receiving", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("Lot number for Widget"), { target: { value: "LOT-9001" } });
    pickDate("Expiry date for Widget", "2027-06-30");
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", {
        status: "received",
        lot_numbers: { 10: "LOT-9001" },
        expiry_dates: { 10: "2027-06-30" },
      });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("sends the lpn id when receiving into an existing LPN", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    const queryClient = makeQueryClient();
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />, { queryClient });
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    await vi.waitFor(() => expect(queryClient.getQueryState(["lpns", "order-picker"])?.status).toBe("success"));
    fireEvent.change(screen.getByLabelText("LPN for Widget"), { target: { value: "LPN-1001" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received", lpn_ids: { 10: 7 } });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("does not submit when the LPN is unknown", async () => {
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("LPN for Widget"), { target: { value: "LPN-NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => expect(putMock).not.toHaveBeenCalled());
  });

  it("auto-fills the single LPN available at the chosen receive location", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 5, path: "Main Warehouse" }] } });
      if (url === "/lpns") {
        return Promise.resolve({ data: { items: [{ id: 7, lpn_number: "LPN-1001", content_count: 0, total_quantity: 0 }] } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    const queryClient = makeQueryClient();
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />, { queryClient });
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    await vi.waitFor(() => expect(queryClient.getQueryState(["locations", "order-picker"])?.status).toBe("success"));
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Main Warehouse" } });
    await vi.waitFor(() => expect(queryClient.getQueryState(["lpns", "by-location", 5])?.status).toBe("success"));
    await vi.waitFor(() => expect((screen.getByLabelText("LPN for Widget") as HTMLInputElement).value).toBe("LPN-1001"));
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", {
        status: "received",
        receive_locations: { 10: 5 },
        lpn_ids: { 10: 7 },
      });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("resolves an LPN that is only in the location-scoped list, not the truncated global list", async () => {
    getMock.mockImplementation((url: string, config?: any) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 5, path: "Main Warehouse" }] } });
      if (url === "/lpns") {
        const items = config?.params?.location_id
          ? [{ id: 9, lpn_number: "PAL-1001", content_count: 0, total_quantity: 0 }]
          : [{ id: 7, lpn_number: "LPN-1001" }];
        return Promise.resolve({ data: { items } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    const queryClient = makeQueryClient();
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />, { queryClient });
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    await vi.waitFor(() => expect(queryClient.getQueryState(["locations", "order-picker"])?.status).toBe("success"));
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Main Warehouse" } });
    await vi.waitFor(() => expect(queryClient.getQueryState(["lpns", "by-location", 5])?.status).toBe("success"));
    fireEvent.change(screen.getByLabelText("LPN for Widget"), { target: { value: "PAL-1001" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", {
        status: "received",
        receive_locations: { 10: 5 },
        lpn_ids: { 10: 9 },
      });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("sends receive_quantities when receiving a partial quantity", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("Quantity to receive for Widget"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received", receive_quantities: { 10: 1 } });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("does not send receive_quantities when every line is at full quantity", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received" });
      const arg = putMock.mock.calls[0][1];
      expect(arg.receive_quantities).toBeUndefined();
    });
  });

  it("does not submit when the receive quantity exceeds the ordered amount", async () => {
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("Quantity to receive for Widget"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => expect(putMock).not.toHaveBeenCalled());
  });

  it("uses the receive quantity for the serial count check on a partial serialized receive", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget SN", is_serialized: true }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    fireEvent.change(screen.getByLabelText("Quantity to receive for Widget SN"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Serial numbers for Widget SN"), { target: { value: "SN-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive Order" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", {
        status: "received",
        receive_quantities: { 10: 1 },
        serial_numbers: { 10: ["SN-001"] },
      });
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("marks an approved order as acknowledged and in transit", async () => {
    putMock.mockResolvedValue({ data: {} });
    const order = makeOrder();
    const onUpdated = vi.fn();
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Acknowledged" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "acknowledged" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark In Transit" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "in_transit" }));
  });
});
