import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import RestaurantTicketDetail from "../pages/restaurant/RestaurantTicketDetail";
import api from "../api/client";
import { renderWithProviders } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../context/RealtimeContext", () => ({
  useRealtime: () => ({ subscribe: vi.fn(() => () => {}) }),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: { currency_symbol: "$", tax_rate: 0 } }),
}));

vi.mock("../components/BarcodeScanner", () => ({ default: () => null }));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

function line(id: number, name: string, qty: number, price: number, status = "served") {
  return {
    id,
    product_id: id,
    product_name: name,
    quantity: qty,
    unit_price: price,
    line_total: price * qty,
    status,
    modifiers: null,
    notes: "",
    sent_at: "2026-01-01T10:00:00Z",
    ready_at: "2026-01-01T10:10:00Z",
    served_at: "2026-01-01T10:20:00Z",
  };
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    ticket_number: "T-0007",
    table_id: 1,
    table_number: "T-1",
    table_zone: "Main",
    status: "served",
    guest_count: 2,
    customer_name: "",
    customer_phone: "",
    subtotal: 46,
    discount_amount: 0,
    tip_amount: 0,
    total_amount: 46,
    notes: "",
    opened_at: "2026-01-01T10:00:00Z",
    settled_at: null,
    sale_id: null,
    items: [line(1, "Steak", 1, 26), line(2, "Fries", 1, 8), line(3, "Cola", 2, 6)],
    ...overrides,
  };
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/restaurant/tickets/:id" element={<RestaurantTicketDetail />} />
    </Routes>,
    { route: "/restaurant/tickets/7" }
  );
}

async function openSettle() {
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: /Settle/ }));
  return screen.findByRole("dialog", { name: /Settle T-0007/ });
}

describe("RestaurantTicketDetail settle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/tickets/7") return Promise.resolve({ data: ticket() });
      if (url === "/restaurant/menu") return Promise.resolve({ data: [] });
      if (url === "/customers") return Promise.resolve({ data: { items: [] } });
      return Promise.resolve({ data: [] });
    });
  });

  it("computes the total, blocks an under-tendered cash settle, then submits", async () => {
    postMock.mockResolvedValue({ data: ticket({ status: "settled", settled_at: "2026-01-01T11:00:00Z", tip_amount: 4 }) });
    const dialog = await openSettle();

    expect(within(dialog).getAllByText("$46.00").length).toBeGreaterThan(0);

    fireEvent.change(within(dialog).getByLabelText(/Cash tendered/), { target: { value: "20" } });
    fireEvent.change(within(dialog).getByLabelText(/Tip/), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle Now" }));

    expect(await screen.findByText(/Tendered value is short by/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Cash tendered/), { target: { value: "60" } });
    expect(within(dialog).getByText("Change due").parentElement).toHaveTextContent("Change due$10.00");
    expect(within(dialog).queryByText("Short")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Settle Now" }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/tickets/7/settle", {
        payment_method: "cash",
        tip_amount: 4,
      });
    });
  });

  it("caps a discount at the ticket subtotal and includes it in the payload", async () => {
    postMock.mockResolvedValue({ data: ticket({ status: "settled" }) });
    const dialog = await openSettle();

    fireEvent.change(within(dialog).getByLabelText(/Discount/), { target: { value: "999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle Now" }));
    expect(await screen.findByText("Discount cannot exceed the ticket subtotal")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Discount/), { target: { value: "6" } });
    fireEvent.change(within(dialog).getByLabelText(/Cash tendered/), { target: { value: "40" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle Now" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/tickets/7/settle", {
        payment_method: "cash",
        discount_amount: 6,
      });
    });
  });

  it("requires a phone for mobile money and pushes the STK prompt once settled", async () => {
    postMock.mockImplementation((url: string) => {
      if (url === "/restaurant/tickets/7/settle") {
        return Promise.resolve({ data: ticket({ status: "paying", sale_id: 99, total_amount: 46 }) });
      }
      if (url === "/daraja/stk-push") {
        return Promise.resolve({ data: { success: true, checkout_request_id: "req-1" } });
      }
      return Promise.resolve({ data: {} });
    });
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: {} });

    const dialog = await openSettle();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Payment method" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mobile Money" }));
    fireEvent.click(await screen.findByRole("option", { name: "M-Pesa" }));

    const collect = within(dialog).getByRole("button", { name: "Collect Payment" });
    expect(collect).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Phone number/), { target: { value: "0712345678" } });
    expect(within(dialog).getByRole("button", { name: "Collect Payment" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Collect Payment" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/tickets/7/settle", expect.objectContaining({ payment_method: "mobile_money", payment_phone: "0712345678" }));
    });
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/daraja/stk-push", expect.objectContaining({ phone: "0712345678", amount: 46, reference: "T-0007" }));
    });
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/sales/99/checkout-id", { checkout_request_id: "req-1" });
    });
  });

  it("surfaces a settle failure as a toast and keeps the modal open", async () => {
    postMock.mockRejectedValue({ response: { data: { detail: "Table already has an active ticket" } } });
    const dialog = await openSettle();
    fireEvent.change(within(dialog).getByLabelText(/Cash tendered/), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle Now" }));
    expect(await screen.findByText("Table already has an active ticket")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Settle T-0007/ })).toBeInTheDocument();
  });
});

describe("RestaurantTicketDetail split", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/tickets/7") return Promise.resolve({ data: ticket() });
      if (url === "/restaurant/menu") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
  });

  async function openSplit() {
    renderDetail();
    fireEvent.click(await screen.findByLabelText("Split T-0007"));
    return screen.findByRole("dialog", { name: /Split T-0007/ });
  }

  it("summarises what moves and what stays, then posts the split", async () => {
    postMock.mockResolvedValue({ data: ticket({ id: 8, ticket_number: "T-0008" }) });
    const dialog = await openSplit();

    expect(within(dialog).getByText("Moving to new bill").nextSibling).toHaveTextContent("$0.00");
    expect(within(dialog).getByText("Staying on this bill").nextSibling).toHaveTextContent("$46.00");

    const boxes = within(dialog).getAllByRole("checkbox");
    fireEvent.click(boxes[0]);

    expect(within(dialog).getByText("Moving to new bill").nextSibling).toHaveTextContent("$26.00");
    expect(within(dialog).getByText("Staying on this bill").nextSibling).toHaveTextContent("$20.00");
    expect(within(dialog).getByText("1 to move")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Guest count/), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText(/Customer \/ booking name/), { target: { value: "Amina" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Split Bill" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/tickets/7/split", {
        item_ids: [1],
        guest_count: 3,
        customer_name: "Amina",
      });
    });
  });

  it("excludes voided items from the split selection", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/tickets/7") {
        return Promise.resolve({
          data: ticket({
            items: [line(1, "Steak", 1, 26), line(2, "Fries", 1, 8, "voided")],
          }),
        });
      }
      return Promise.resolve({ data: [] });
    });
    const dialog = await openSplit();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(dialog).getByText("Steak")).toBeInTheDocument();
    expect(within(dialog).queryByText("Fries")).not.toBeInTheDocument();
  });

  it("does not post when the split would move every item", async () => {
    const dialog = await openSplit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Select all" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Split Bill" }));
    expect(await screen.findByText("Keep at least one item on the original bill")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });
});
