import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import PortalOverview from "../pages/portal/PortalOverview";
import PortalOrders from "../pages/portal/PortalOrders";
import PortalOrderDetail from "../pages/portal/PortalOrderDetail";
import PortalASNs from "../pages/portal/PortalASNs";
import PortalASNDetail from "../pages/portal/PortalASNDetail";
import PortalReceipts from "../pages/portal/PortalReceipts";
import PortalReceiptDetail from "../pages/portal/PortalReceiptDetail";

const getMock = api.get as ReturnType<typeof vi.fn>;
const patchMock = api.patch as ReturnType<typeof vi.fn>;

const ME = {
  user: { id: 9, username: "acme_portal", email: "acme@example.com", role: "supplier", supplier_id: 1, supplier_name: "Acme Logistics" },
  supplier: { id: 1, name: "Acme Logistics" },
  store_name: "My Store",
  currency_symbol: "$",
};

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    order_number: "PO-2026-0001",
    supplier_id: 1,
    user_id: 2,
    status: "approved",
    total_amount: 120,
    notes: "",
    expected_arrival: "2026-03-10T00:00:00",
    created_at: "2026-03-01T00:00:00",
    updated_at: "2026-03-01T00:00:00",
    received_at: null,
    approved_by: 2,
    approved_at: "2026-03-01T00:00:00",
    supplier_name: "Acme Logistics",
    username: "admin",
    approver_name: "admin",
    items: [
      { id: 11, product_id: 5, quantity: 2, received_qty: 0, unit_price: 60, product_name: "Widget", product_image: "", is_serialized: false, sku: "WGT-1" },
    ],
    ...overrides,
  };
}

function makeASN(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    asn_number: "ASN-2026-0001",
    supplier_id: 1,
    user_id: 9,
    status: "pending",
    expected_arrival: "2026-03-12T00:00:00",
    received_at: null,
    total_expected: 2,
    total_received: 0,
    notes: "",
    created_at: "2026-03-05T00:00:00",
    updated_at: "2026-03-05T00:00:00",
    supplier_name: "Acme Logistics",
    username: "acme_portal",
    order_id: 1,
    order_number: "PO-2026-0001",
    items: [
      { id: 21, asn_id: 1, product_id: 5, expected_qty: 2, received_qty: 0, unit_cost: 60, status: "pending", product_name: "Widget", location_id: 1, location_name: "Main Aisle" },
    ],
    ...overrides,
  };
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    receipt_number: "RCT-2026-0001",
    supplier_id: 1,
    user_id: 2,
    reference: "PO-2026-0001",
    notes: "",
    total_quantity: 2,
    total_cost: 120,
    created_at: "2026-03-11T00:00:00",
    supplier_name: "Acme Logistics",
    username: "admin",
    items: [
      { id: 31, receipt_id: 1, product_id: 5, quantity: 2, unit_cost: 60, lot_id: 1, location_id: 1, product_name: "Widget", product_image: "", lot_number: "LOT-1", location_name: "Main Aisle" },
    ],
    ...overrides,
  };
}

function mockPortal(pages: { order?: ReturnType<typeof makeOrder>; asn?: ReturnType<typeof makeASN>; receipt?: ReturnType<typeof makeReceipt> } = {}) {
  const order = pages.order ?? makeOrder();
  const asn = pages.asn ?? makeASN();
  const receipt = pages.receipt ?? makeReceipt();
  getMock.mockImplementation((url: string) => {
    if (url === "/portal/me") return Promise.resolve({ data: ME });
    if (url === "/portal/summary") {
      return Promise.resolve({
        data: {
          status_counts: { approved: 1, acknowledged: 0, in_transit: 0, received: 0, cancelled: 0 },
          total_orders: 1,
          open_orders: 1,
          open_value: 120,
          recent_orders: [{ ...order, total_amount: 50 }],
          asn_counts: { pending: 1, received: 0, cancelled: 0 },
          total_asns: 1,
          receipt_count: 1,
          recent_asns: [asn],
          recent_receipts: [receipt],
        },
      });
    }
    if (url === "/portal/orders") {
      const items = [order];
      return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    }
    if (url.startsWith("/portal/orders/")) {
      const id = Number(url.split("/").pop());
      if (id !== 1) return Promise.reject({ response: { status: 404, data: { detail: "Order not found" } } });
      return Promise.resolve({ data: order });
    }
    if (url === "/portal/asns") {
      const items = [asn];
      return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    }
    if (url === "/portal/receipts") {
      const items = [receipt];
      return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    }
    if (url.startsWith("/portal/asns/")) {
      const id = Number(url.split("/").pop());
      if (id !== 1) return Promise.reject({ response: { status: 404, data: { detail: "ASN not found" } } });
      return Promise.resolve({ data: asn });
    }
    if (url.startsWith("/portal/receipts/")) {
      const id = Number(url.split("/").pop());
      if (id !== 1) return Promise.reject({ response: { status: 404, data: { detail: "Receipt not found" } } });
      return Promise.resolve({ data: receipt });
    }
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Supplier Portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders overview summary cards and recent orders", async () => {
    mockPortal();
    renderWithProviders(<PortalOverview />, { role: "supplier" });
    expect(await screen.findByText("Welcome, Acme Logistics")).toBeInTheDocument();
    expect(screen.getByText("Total orders")).toBeInTheDocument();
    expect(screen.getAllByText("PO-2026-0001").length).toBeGreaterThan(0);
    expect(screen.getByText("$120.00")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("lists only the supplier's orders with status filter options", async () => {
    mockPortal();
    renderWithProviders(<PortalOrders />, { role: "supplier" });
    expect(await screen.findByText("PO-2026-0001")).toBeInTheDocument();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    const search = screen.getByPlaceholderText("Search by order number...");
    fireEvent.change(search, { target: { value: "PO-2026" } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/portal/orders", expect.objectContaining({ params: expect.objectContaining({ search: "PO-2026" }) }))
    );
  });

  it("renders order detail with line items and acknowledge action", async () => {
    mockPortal();
    patchMock.mockResolvedValue({ data: makeOrder({ status: "acknowledged" }) });
    renderWithProviders(
      <Routes>
        <Route path="/portal/orders/:id" element={<PortalOrderDetail />} />
      </Routes>,
      { role: "supplier", route: "/portal/orders/1" }
    );
    expect(await screen.findByText("PO-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("WGT-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("/portal/orders/1", { status: "acknowledged" }));
  });

  it("offers mark-in-transit for acknowledged orders", async () => {
    mockPortal({ order: makeOrder({ status: "acknowledged" }) });
    patchMock.mockResolvedValue({ data: makeOrder({ status: "in_transit" }) });
    renderWithProviders(
      <Routes>
        <Route path="/portal/orders/:id" element={<PortalOrderDetail />} />
      </Routes>,
      { role: "supplier", route: "/portal/orders/1" }
    );
    expect(await screen.findByRole("button", { name: "Mark in transit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
  });

  it("shows PDF download button on the detail page", async () => {
    mockPortal();
    getMock.mockImplementation((url: string) => {
      if (url === "/portal/me") return Promise.resolve({ data: ME });
      if (url === "/portal/orders/1") return Promise.resolve({ data: makeOrder() });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(
      <Routes>
        <Route path="/portal/orders/:id" element={<PortalOrderDetail />} />
      </Routes>,
      { role: "supplier", route: "/portal/orders/1" }
    );
    expect(await screen.findByRole("button", { name: "Download order PDF" })).toBeInTheDocument();
  });

  it("renders overview shipment and delivery cards", async () => {
    mockPortal();
    renderWithProviders(<PortalOverview />, { role: "supplier" });
    expect(await screen.findByText("Shipments")).toBeInTheDocument();
    expect(screen.getByText("Open shipments")).toBeInTheDocument();
    expect(screen.getByText("Deliveries")).toBeInTheDocument();
    expect(await screen.findByText("ASN-2026-0001")).toBeInTheDocument();
  });

  it("lists the supplier's shipments with status filter", async () => {
    mockPortal();
    renderWithProviders(<PortalASNs />, { role: "supplier" });
    expect(await screen.findByText("ASN-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Shipments")).toBeInTheDocument();
    const search = screen.getByPlaceholderText("Search by ASN number...");
    fireEvent.change(search, { target: { value: "ASN-2026" } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/portal/asns", expect.objectContaining({ params: expect.objectContaining({ search: "ASN-2026" }) }))
    );
  });

  it("renders shipment detail with line items and PDF button", async () => {
    mockPortal();
    renderWithProviders(
      <Routes>
        <Route path="/portal/asns/:id" element={<PortalASNDetail />} />
      </Routes>,
      { role: "supplier", route: "/portal/asns/1" }
    );
    expect(await screen.findByText("ASN-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("PO-2026-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download shipment PDF" })).toBeInTheDocument();
  });

  it("lists the supplier's deliveries", async () => {
    mockPortal();
    renderWithProviders(<PortalReceipts />, { role: "supplier" });
    expect(await screen.findByText("RCT-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Deliveries")).toBeInTheDocument();
    const search = screen.getByPlaceholderText("Search by receipt number...");
    fireEvent.change(search, { target: { value: "RCT" } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/portal/receipts", expect.objectContaining({ params: expect.objectContaining({ search: "RCT" }) }))
    );
  });

  it("renders delivery detail with line items and PDF button", async () => {
    mockPortal();
    renderWithProviders(
      <Routes>
        <Route path="/portal/receipts/:id" element={<PortalReceiptDetail />} />
      </Routes>,
      { role: "supplier", route: "/portal/receipts/1" }
    );
    expect(await screen.findByText("RCT-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download delivery PDF" })).toBeInTheDocument();
  });
});