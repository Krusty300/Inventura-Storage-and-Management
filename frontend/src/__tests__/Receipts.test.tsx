import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Receipts from "../pages/Receipts";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    receipt_number: "RCV-0001",
    supplier_id: 1,
    user_id: 1,
    reference: "PO-1001",
    notes: "",
    total_quantity: 120,
    total_cost: 150.5,
    created_at: "2026-01-01T10:00:00",
    supplier_name: "Acme Supplies",
    username: "tester",
    items: [],
    ...overrides,
  };
}

function mockReceipts(items: ReturnType<typeof mockReceipt>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/receipts") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Receipts Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders receipt rows with supplier and totals", async () => {
    mockReceipts([mockReceipt()]);
    renderWithProviders(<Receipts />);
    expect(await screen.findByText("RCV-0001")).toBeInTheDocument();
    expect(screen.getByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("150.50")).toBeInTheDocument();
  });

  it("shows admin actions for admins", async () => {
    mockReceipts([mockReceipt()]);
    renderWithProviders(<Receipts />);
    expect(await screen.findByText("RCV-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Receipt" })).toBeInTheDocument();
    expect(screen.getByLabelText("Export receipts to CSV")).toBeInTheDocument();
    expect(screen.getByLabelText("View receipt RCV-0001")).toBeInTheDocument();
  });

  it("hides admin actions for workers", async () => {
    mockReceipts([mockReceipt()]);
    renderWithProviders(<Receipts />, { role: "worker" });
    expect(await screen.findByText("RCV-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record Receipt" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Export receipts to CSV")).toBeInTheDocument();
    expect(screen.getByLabelText("View receipt RCV-0001")).toBeInTheDocument();
  });

  it("shows empty state when no receipts", async () => {
    mockReceipts([]);
    renderWithProviders(<Receipts />);
    expect(await screen.findByText("No receipts yet")).toBeInTheDocument();
  });
});
