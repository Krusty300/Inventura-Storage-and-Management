import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import GuestOrder from "../pages/restaurant/GuestOrder";
import api from "../api/client";
import { makeQueryClient } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: { currency_symbol: "$" } }),
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

const TABLE = {
  id: 3,
  number: "T-3",
  zone: "Patio",
  capacity: 4,
  pos_x: 0,
  pos_y: 0,
  is_active: true,
  status: "available",
  active_ticket_id: null,
  active_ticket_number: null,
  active_ticket_username: "",
  service_requested_at: null,
  service_request: null,
};

const SOUP = { id: 11, name: "Soup", display_name: "Soup", description: "", sku: "S1", unit_price: 8, image_url: "", image: "", section_id: 1, available: true };
const SALAD = { id: 12, name: "Salad", display_name: "Salad", description: "", sku: "S2", unit_price: 10, image_url: "", image: "", section_id: 1, available: false };

const MENU = [
  { id: 1, name: "Starters", description: "", item_count: 2, items: [SOUP, SALAD] },
];

function placedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    token: "tok-abc",
    ticket_number: "T-0001",
    table_id: 3,
    table_number: "T-3",
    status: "preparing",
    guest_count: 1,
    guest_name: "",
    guest_phone: "",
    subtotal: 8,
    total_amount: 8,
    opened_at: "2026-01-01T10:00:00Z",
    items: [
      { id: 5, product_id: 11, product_name: "Soup", quantity: 1, unit_price: 8, status: "preparing", modifiers: null, notes: "" },
    ],
    ...overrides,
  };
}

function renderGuest(tableId = "3") {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/order/${tableId}`]}>
        <Routes>
          <Route path="/order/:tableId" element={<GuestOrder />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function addSoupToCart() {
  fireEvent.click(await screen.findByRole("button", { name: /Soup/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Add \d/ }));
}

describe("GuestOrder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/public/tables/3") return Promise.resolve({ data: TABLE });
      if (url === "/restaurant/public/menu") return Promise.resolve({ data: MENU });
      if (url === "/restaurant/public/orders/tok-abc") return Promise.resolve({ data: placedOrder() });
      return Promise.resolve({ data: [] });
    });
    postMock.mockResolvedValue({ data: placedOrder() });
  });

  it("renders the table header and disables out-of-stock menu items", async () => {
    renderGuest();
    expect(await screen.findByText(/Table T-3/)).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salad/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Soup/ })).toBeEnabled();
  });

  it("keys the cart per table and clears the legacy shared key", async () => {
    localStorage.setItem("guest-cart", JSON.stringify([]));
    localStorage.setItem("guest-cart-9", JSON.stringify([
      { key: "11|2||", product: SOUP, quantity: 2, modifiers: [], modifierNames: [], notes: "", extras: 0 },
    ]));

    const first = renderGuest("3");
    await screen.findByText(/Table T-3/);
    expect(localStorage.getItem("guest-cart")).toBeNull();
    expect(localStorage.getItem("guest-cart-9")).not.toBeNull();
    first.unmount();

    renderGuest("9");
    await waitFor(() => expect(screen.getByText("2 items")).toBeInTheDocument());
  });

  it("polls the placed order by token and renders the live status", async () => {
    renderGuest();
    await addSoupToCart();
    expect(await screen.findByText("1 item")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Send order/ }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/public/orders", expect.objectContaining({ table_id: 3 }));
    });
    expect(await screen.findByText("Order T-0001")).toBeInTheDocument();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/restaurant/public/orders/tok-abc"));
  });

  it("raises and confirms a waiter service request", async () => {
    postMock.mockResolvedValue({ data: { ...TABLE, service_request: "waiter" } });
    renderGuest();

    fireEvent.click(await screen.findByLabelText("Call waiter"));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/public/tables/3/service-request", { request: "waiter" });
    });
    expect(await screen.findByText("Waiter notified")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Request the bill"));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/public/tables/3/service-request", { request: "bill" });
    });
  });

  it("surfaces a failed order placement", async () => {
    postMock.mockRejectedValue({ response: { data: { detail: "Insufficient stock: Soup (need 1)" } } });
    renderGuest();
    await addSoupToCart();
    fireEvent.click(screen.getByRole("button", { name: /Send order/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient stock: Soup (need 1)");
  });
});
