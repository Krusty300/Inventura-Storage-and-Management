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

function mockPortal(pages: { order?: ReturnType<typeof makeOrder> } = {}) {
  getMock.mockImplementation((url: string) => {
    if (url === "/portal/me") return Promise.resolve({ data: ME });
    if (url === "/portal/summary") {
      return Promise.resolve({
        data: {
          status_counts: { approved: 1, acknowledged: 0, in_transit: 0, received: 0, cancelled: 0 },
          total_orders: 1,
          open_orders: 1,
          open_value: 120,
          recent_orders: [pages.order ?? makeOrder({ total_amount: 50 })],
        },
      });
    }
    if (url === "/portal/orders") {
      const items = [pages.order ?? makeOrder()];
      return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    }
    if (url.startsWith("/portal/orders/")) {
      const id = Number(url.split("/").pop());
      if (id !== 1) return Promise.reject({ response: { status: 404, data: { detail: "Order not found" } } });
      return Promise.resolve({ data: pages.order ?? makeOrder() });
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
    expect(screen.getByText("PO-2026-0001")).toBeInTheDocument();
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
});