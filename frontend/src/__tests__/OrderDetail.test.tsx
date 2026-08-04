import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
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
    status: "pending",
    total_amount: 250,
    notes: "",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    username: "tester",
    items: [],
    ...overrides,
  };
}

describe("OrderDetail serialized receive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getMock.mockImplementation((url: string) => {
      if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
  });

  it("shows serial number inputs for serialized items when receiving", async () => {
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget SN", is_serialized: true }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    expect(screen.getByLabelText("Serial numbers for Widget SN")).toBeInTheDocument();
    expect(screen.getByText("Widget SN — enter 2 serial number(s), one per line")).toBeInTheDocument();
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

  it("receives non-serialized order via plain confirm without serial inputs", async () => {
    putMock.mockResolvedValue({ data: { status: "received" } });
    const onUpdated = vi.fn();
    const order = makeOrder({
      items: [{ id: 1, product_id: 10, quantity: 2, unit_price: 5, product_name: "Widget", is_serialized: false }],
    });
    renderWithProviders(<OrderDetail order={order} onClose={() => {}} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Received" }));
    expect(screen.getByText("Receive PO-1001 and update stock?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, proceed" }));
    await vi.waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/orders/1", { status: "received" });
    });
    expect(onUpdated).toHaveBeenCalled();
  });
});
