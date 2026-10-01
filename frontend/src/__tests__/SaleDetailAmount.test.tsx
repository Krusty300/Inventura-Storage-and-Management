import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import SaleDetail from "../components/SaleDetail";
import type { Sale } from "../types";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockSale(overrides: Record<string, unknown> = {}): Sale {
  return {
    id: 1,
    invoice_number: "INV-0001",
    customer_id: null,
    user_id: 1,
    subtotal: 90.0,
    discount_amount: 0.0,
    tax_amount: 9.0,
    total_amount: 99.0,
    status: "completed",
    payment_method: "mobile_money",
    payment_provider: "m-pesa",
    payment_reference: "QHK1ABC",
    payment_phone: "0712345678",
    payment_provider_amount: 99.0,
    payment_amount_received: 99.0,
    payment_amount_status: "matched",
    currency: "KES",
    currency_symbol: "KSh",
    payment_status: "completed",
    payment_checkout_request_id: "ws_CO_1",
    refund_status: null,
    refunded_at: null,
    refund_method: null,
    refund_provider: null,
    refund_checkout_request_id: null,
    promo_code: null,
    promo_discount: 0.0,
    channel_id: null,
    shipment_id: null,
    notes: "",
    sale_id: null,
    table_number: null,
    guest_count: 0,
    username: "tester",
    customer_name: "Walk-in Customer",
    channel_name: "",
    created_at: "2026-01-01T10:00:00",
    updated_at: "2026-01-01T10:00:00",
    items: [],
    locations: [],
    ...overrides,
  } as unknown as Sale;
}

function mockSettings() {
  getMock.mockImplementation((url: string) => {
    if (url === "/settings") {
      return Promise.resolve({ data: { currency: "KES", currency_symbol: "KSh", tax_rate: 16, store_name: "Demo" } });
    }
    if (url === "/users/me") return Promise.resolve({ data: { id: 1, role: "admin" } });
    return Promise.resolve({ data: {} });
  });
}

describe("SaleDetail amount verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSettings();
  });

  it("shows no warning when the amount received matches", async () => {
    renderWithProviders(<SaleDetail sale={mockSale()} onClose={() => {}} />);

    await screen.findByText("INV-0001");
    expect(screen.getByText("Amount received:")).toBeInTheDocument();
    expect(screen.queryByText(/Under-paid/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Over-paid/)).not.toBeInTheDocument();
  });

  it("flags an under-payment and keeps it marked completed", async () => {
    renderWithProviders(
      <SaleDetail
        sale={mockSale({ payment_amount_received: 40.0, payment_amount_status: "short" })}
        onClose={() => {}}
      />,
    );

    await screen.findByText("INV-0001");
    expect(screen.getByText("Under-paid")).toBeInTheDocument();
    expect(screen.getByText(/M-Pesa reported/)).toBeInTheDocument();
    // The payment is real money, so it is not silently reverted.
    expect(screen.getByText(/kept as received/)).toBeInTheDocument();
    expect(screen.getByText(/Refund or write off the difference/)).toBeInTheDocument();
  });

  it("flags an over-payment", async () => {
    renderWithProviders(
      <SaleDetail
        sale={mockSale({ payment_amount_received: 150.0, payment_amount_status: "over" })}
        onClose={() => {}}
      />,
    );

    await screen.findByText("INV-0001");
    expect(screen.getByText("Over-paid")).toBeInTheDocument();
  });

  it("says so when the callback carried no amount at all", async () => {
    renderWithProviders(
      <SaleDetail
        sale={mockSale({ payment_amount_received: null, payment_amount_status: "unknown" })}
        onClose={() => {}}
      />,
    );

    await screen.findByText("INV-0001");
    expect(screen.getByText("Amount not reported")).toBeInTheDocument();
    expect(screen.getByText(/could not be verified/)).toBeInTheDocument();
  });
});
