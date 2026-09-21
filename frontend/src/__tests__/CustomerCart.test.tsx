import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../context/ToastContext";
import { CustomerCartProvider } from "../context/CustomerCartContext";
import CustomerCart from "../pages/portal/CustomerCart";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

const ME = {
  user: { id: 10, username: "customer_portal", email: "cust@example.com", role: "customer", customer_id: 1, customer_name: "DC Widgets" },
  customer: { id: 1, name: "DC Widgets" },
  store_name: "My Store",
  currency_symbol: "$",
  logo_url: "",
  tax_rate: 10,
};

const PRODUCT = {
  id: 7,
  sku: "CO-TEST",
  name: "Test Widget",
  description: "",
  category_name: "Test",
  unit_price: 20,
  price: 12.5,
  image_url: "",
  in_stock: true,
};

function seedCart(quantity = 2) {
  localStorage.setItem("customer_cart_v1", JSON.stringify([{ product: PRODUCT, quantity }]));
}

function renderCart(quantity = 2) {
  seedCart(quantity);
  getMock.mockResolvedValue({ data: ME });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/portal/cart"]}>
        <ToastProvider>
          <CustomerCartProvider>
            <Routes>
              <Route path="/portal/cart" element={<CustomerCart />} />
              <Route path="/portal/invoices/:id" element={<div>Invoice Detail Page</div>} />
            </Routes>
          </CustomerCartProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CustomerCart", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it("renders line items and computed totals from the stored cart", async () => {
    renderCart(2);
    expect(await screen.findByText("Test Widget")).toBeInTheDocument();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Quantity")).toHaveTextContent("2");
    // Subtotal, 10% tax, and total (after /customer/me resolves).
    expect(await screen.findByText("Tax (10%)")).toBeInTheDocument();
    expect(await screen.findByText("$2.50")).toBeInTheDocument();
    expect(await screen.findByText("$27.50")).toBeInTheDocument();
  });

  it("updates line when quantity is increased", async () => {
    renderCart(2);
    const plus = await screen.findByLabelText("Increase quantity of Test Widget");
    fireEvent.click(plus);
    expect(screen.getByLabelText("Quantity")).toHaveTextContent("3");
    expect(screen.getAllByText("$37.50").length).toBeGreaterThan(0);
  });

  it("re-quotes live prices so totals match the tiered checkout price", async () => {
    postMock.mockImplementation((url: string) => {
      if (url === "/customer/pricing") {
        return Promise.resolve({
          data: {
            items: [{ product_id: 7, unit_price: 10, line_total: 20 }],
            subtotal: 20,
            tax_rate: 10,
            tax_amount: 2,
            total: 22,
          },
        });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    renderCart(2);
    // Line total re-priced at the tiered unit price (also shown as subtotal).
    expect((await screen.findAllByText("$20.00")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("$10.00 each")).toBeInTheDocument();
    // Tax and total come from the live quote, not the snapshot.
    expect(await screen.findByText("$2.00")).toBeInTheDocument();
    expect(await screen.findByText("$22.00")).toBeInTheDocument();
  });

  it("clears the cart if all items are removed", async () => {
    renderCart(1);
    const remove = await screen.findByLabelText("Remove Test Widget from cart");
    fireEvent.click(remove);
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
  });

  it("posts checkout payload and navigates to the invoice detail", async () => {
    renderCart(2);
    postMock.mockResolvedValue({ data: { id: 99, invoice_number: "INV-2010", status: "completed" } });
    fireEvent.click(await screen.findByText("Bank Transfer"));
    const refInput = await screen.findByPlaceholderText("e.g. card or transfer reference");
    fireEvent.change(refInput, { target: { value: "TRF-1" } });
    fireEvent.click(await screen.findByText("Place order · $27.50"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/customer/checkout", {
        items: [{ product_id: 7, quantity: 2 }],
        payment_method: "transfer",
        payment_reference: "TRF-1",
      });
    });
    expect(await screen.findByText("Invoice Detail Page")).toBeInTheDocument();
    expect(localStorage.getItem("customer_cart_v1")).toBe("[]");
  });

  it("renders an empty state when no items are stored", async () => {
    getMock.mockResolvedValue({ data: ME });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/portal/cart"]}>
          <ToastProvider>
            <CustomerCartProvider>
              <Routes>
                <Route path="/portal/cart" element={<CustomerCart />} />
              </Routes>
            </CustomerCartProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
  });
});