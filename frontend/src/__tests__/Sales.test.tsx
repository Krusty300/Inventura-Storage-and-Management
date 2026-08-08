import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Sales from "../pages/Sales";

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

function mockSale(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    invoice_number: "INV-0001",
    customer_id: null,
    user_id: 1,
    subtotal: 90.0,
    tax_amount: 9.0,
    total_amount: 99.0,
    status: "completed",
    payment_method: "cash",
    notes: "",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    customer_name: "Walk-in Customer",
    username: "tester",
    items: [],
    locations: [],
    ...overrides,
  };
}

function mockSales(items: ReturnType<typeof mockSale>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/sales") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Sales Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders sale rows with invoice number and total", async () => {
    mockSales([mockSale()]);
    renderWithProviders(<Sales />);
    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("$99.00")).toBeInTheDocument();
    expect(screen.getByText("Walk-in Customer")).toBeInTheDocument();
  });

  it("shows the source location column for each sale", async () => {
    mockSales([
      mockSale({ locations: ["Warehouse A", "Store B"] }),
      mockSale({ id: 2, invoice_number: "INV-0002", locations: ["Warehouse A"] }),
      mockSale({ id: 3, invoice_number: "INV-0003", locations: [] }),
    ]);
    renderWithProviders(<Sales />);
    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("Warehouse A, Store B")).toBeInTheDocument();
    expect(screen.getByText("INV-0002").parentElement).toHaveTextContent("Warehouse A");
    expect(screen.getByText("INV-0003").parentElement).toHaveTextContent("—");
  });

  it("shows refund button only for completed sales", async () => {
    mockSales([mockSale(), mockSale({ id: 2, invoice_number: "INV-0002", status: "refunded" })]);
    renderWithProviders(<Sales />);
    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Refund INV-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Refund INV-0002")).not.toBeInTheDocument();
  });

  it("hides refund button for workers", async () => {
    mockSales([mockSale()]);
    renderWithProviders(<Sales />, { role: "worker" });
    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Refund INV-0001")).not.toBeInTheDocument();
  });

  it("refunds a sale through the confirm dialog", async () => {
    mockSales([mockSale()]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Sales />);
    fireEvent.click(await screen.findByLabelText("Refund INV-0001"));
    expect(screen.getByText(/Refund invoice "INV-0001"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refund" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/sales/1/refund"));
  });

  it("updates the search input", async () => {
    mockSales([mockSale()]);
    renderWithProviders(<Sales />);
    const input = await screen.findByLabelText("Search sales");
    fireEvent.change(input, { target: { value: "INV-000" } });
    expect(input).toHaveValue("INV-000");
  });

  it("shows empty state when no sales", async () => {
    mockSales([]);
    renderWithProviders(<Sales />);
    expect(await screen.findByText("No sales yet")).toBeInTheDocument();
  });
});
