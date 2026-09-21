import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { FontSizeProvider } from "../context/FontSizeContext";
import { ToastProvider } from "../context/ToastContext";
import { CustomerCartProvider } from "../context/CustomerCartContext";
import PortalLayout from "../pages/portal/PortalLayout";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;

const ME_SUPPLIER = {
  user: { id: 9, username: "acme_portal", email: "acme@example.com", role: "supplier", supplier_id: 1, supplier_name: "Acme Logistics" },
  supplier: { id: 1, name: "Acme Logistics" },
  store_name: "My Store",
  currency_symbol: "$",
  logo_url: "",
};

const ME_CUSTOMER = {
  user: { id: 10, username: "customer_portal", email: "cust@example.com", role: "customer", customer_id: 1, customer_name: "DC Widgets" },
  customer: { id: 1, name: "DC Widgets" },
  store_name: "My Store",
  currency_symbol: "$",
  logo_url: "",
};

function mockMatchMediaDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function mockMe(role: string) {
  getMock.mockImplementation((url: string) => {
    if (url === "/auth/me") {
      return Promise.resolve({ data: { id: 1, username: "tester", email: "tester@example.com", role } });
    }
    if (url === "/portal/me") return Promise.resolve({ data: ME_SUPPLIER });
    if (url === "/customer/me") return Promise.resolve({ data: ME_CUSTOMER });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

function renderPortal(role: string, route = "/portal") {
  localStorage.setItem("token", "test-token");
  localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role }));
  mockMe(role);
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider>
          <FontSizeProvider>
            <ToastProvider>
              <CustomerCartProvider>
                <AuthProvider>
                  <Routes>
                    <Route path="/portal" element={<PortalLayout />}>
                      <Route index element={<div>Portal Home Page</div>} />
                      <Route path="orders" element={<div>Orders Page</div>} />
                      <Route path="orders/:id" element={<div>Order Detail Page</div>} />
                      <Route path="catalog" element={<div>Customer Catalog Page</div>} />
                    </Route>
                  </Routes>
                </AuthProvider>
              </CustomerCartProvider>
            </ToastProvider>
          </FontSizeProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PortalLayout sidebar navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockMatchMediaDesktop();
  });

  it("shows supplier nav links and highlights the active detail route", async () => {
    renderPortal("supplier", "/portal/orders/5");
    expect(await screen.findByText("Purchase Orders")).toBeInTheDocument();
    expect(screen.getByText("Shipments")).toBeInTheDocument();
    expect(screen.getByText("Deliveries")).toBeInTheDocument();
    expect(screen.queryByText("Catalog")).not.toBeInTheDocument();
    expect(screen.queryByText("Invoices")).not.toBeInTheDocument();
    expect(screen.getByText("Purchase Orders").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Shipments").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Order Detail Page")).toBeInTheDocument();
  });

  it("shows customer nav links for a customer role", async () => {
    renderPortal("customer", "/portal/catalog");
    expect(await screen.findByText("Catalog")).toBeInTheDocument();
    expect(screen.getByText("Invoices")).toBeInTheDocument();
    expect(screen.queryByText("Purchase Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Shipments")).not.toBeInTheDocument();
    expect(screen.getByText("Catalog").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Customer Catalog Page")).toBeInTheDocument();
  });
});