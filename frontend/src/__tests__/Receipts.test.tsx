import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

const serializedAsset = { id: 2, name: "Asset", sku: "SKU-2", display_name: "Asset", is_active: true, is_variant: false, is_serialized: true, variants: [] };
const plainWidget = { id: 3, name: "Widget", sku: "SKU-3", display_name: "Widget", is_active: true, is_variant: false, is_serialized: false, variants: [] };

function mockReceiptForm({ serials = [] }: { serials?: Record<string, unknown>[] } = {}) {
  getMock.mockImplementation((url: string) => {
    if (url === "/receipts") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/products")
      return Promise.resolve({ data: { items: [serializedAsset, plainWidget], total: 2, page: 1, pages: 1 } });
    if (url === "/suppliers") return Promise.resolve({ data: { items: [] } });
    if (url === "/locations")
      return Promise.resolve({
        data: { items: [
          { id: 10, name: "Warehouse B", path: "Warehouse B", is_active: true },
          { id: 11, name: "Warehouse A", path: "Warehouse A", is_active: true },
        ] },
      });
    if (url === "/lpns") return Promise.resolve({ data: { items: [] } });
    if (url === "/serial-numbers")
      return Promise.resolve({ data: { items: serials, total: serials.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

function openReceiptForm() {
  renderWithProviders(<Receipts />);
  fireEvent.click(screen.getByRole("button", { name: "Record Receipt" }));
}

async function selectProduct(id: string, label: string) {
  const option = await screen.findByRole("option", { name: label });
  fireEvent.change(option.closest("select")!, { target: { value: id } });
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

  it("shows record receipt action for workers", async () => {
    mockReceipts([mockReceipt()]);
    renderWithProviders(<Receipts />, { role: "worker" });
    expect(await screen.findByText("RCV-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Receipt" })).toBeInTheDocument();
    expect(screen.getByLabelText("Export receipts to CSV")).toBeInTheDocument();
    expect(screen.getByLabelText("View receipt RCV-0001")).toBeInTheDocument();
  });

  it("shows empty state when no receipts", async () => {
    mockReceipts([]);
    renderWithProviders(<Receipts />);
    expect(await screen.findByText("No receipts yet")).toBeInTheDocument();
  });

  it("prefills the receipt location from the single location holding serialized stock", async () => {
    mockReceiptForm({ serials: [
      { id: 1, product_id: 2, serial_number: "SN-1", lot_id: null, location_id: 10, status: "in_stock", sold_at: null, location_name: "Warehouse B", lot_number: "", product_name: "Asset" },
    ] });
    openReceiptForm();
    await selectProduct("2", "Asset (SKU-2)");
    await waitFor(() => expect(screen.getByLabelText("Location")).toHaveValue("Warehouse B"));
  });

  it("shows location chips when serialized stock spans multiple locations without overriding the field", async () => {
    mockReceiptForm({ serials: [
      { id: 1, product_id: 2, serial_number: "SN-1", lot_id: null, location_id: 10, status: "in_stock", sold_at: null, location_name: "Warehouse B", lot_number: "", product_name: "Asset" },
      { id: 2, product_id: 2, serial_number: "SN-2", lot_id: null, location_id: 11, status: "in_stock", sold_at: null, location_name: "Warehouse A", lot_number: "", product_name: "Asset" },
    ] });
    openReceiptForm();
    await selectProduct("2", "Asset (SKU-2)");
    expect(await screen.findByRole("button", { name: "Warehouse B (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Warehouse A (1)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Warehouse A (1)" }));
    await waitFor(() => expect(screen.getByLabelText("Location")).toHaveValue("Warehouse A"));
  });
});
