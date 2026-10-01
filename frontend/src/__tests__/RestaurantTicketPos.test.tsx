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
const putMock = api.put as ReturnType<typeof vi.fn>;

function menuItem(id: number, name: string, price: number) {
  return {
    id,
    name,
    display_name: name,
    description: "",
    sku: `MNU-${id}`,
    unit_price: price,
    image_url: "",
    image: "",
    section_id: null,
    available: true,
  };
}

const MENU = [
  {
    id: 1,
    name: "Starters",
    description: "",
    item_count: 2,
    items: [menuItem(11, "Soup", 6), menuItem(12, "Salad", 7)],
  },
  {
    id: 2,
    name: "Mains",
    description: "",
    item_count: 2,
    items: [menuItem(21, "Steak", 26), menuItem(22, "Fries", 8)],
  },
  {
    id: null,
    name: "Uncategorised",
    description: "",
    item_count: 1,
    items: [menuItem(31, "Cola", 6)],
  },
];

function pendingLine(id: number, name: string, qty: number, price: number) {
  return {
    id,
    product_id: id,
    product_name: name,
    quantity: qty,
    unit_price: price,
    line_total: price * qty,
    status: "pending",
    modifiers: null,
    notes: "",
    sent_at: null,
    ready_at: null,
    served_at: null,
  };
}

function openTicket(items = [] as ReturnType<typeof pendingLine>[]) {
  return {
    id: 7,
    ticket_number: "TK-0007",
    table_id: 1,
    table_number: "T-1",
    table_zone: "Main",
    status: "open",
    guest_count: 2,
    customer_name: "",
    customer_phone: "",
    subtotal: items.reduce((s, i) => s + i.line_total, 0),
    discount_amount: 0,
    tax_amount: 0,
    tip_amount: 0,
    total_amount: items.reduce((s, i) => s + i.line_total, 0),
    notes: "",
    opened_at: "2026-01-01T10:00:00Z",
    settled_at: null,
    sale_id: null,
    items,
  };
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/restaurant/tickets/:id" element={<RestaurantTicketDetail />} />
    </Routes>,
    { route: "/restaurant/tickets/7", role: "admin" }
  );
}

async function renderPos(items = [] as ReturnType<typeof pendingLine>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/restaurant/tickets/7") return Promise.resolve({ data: openTicket(items) });
    if (url === "/restaurant/menu") return Promise.resolve({ data: MENU });
    return Promise.resolve({ data: [] });
  });
  renderDetail();
  await screen.findByRole("button", { name: /Add Soup to order/ });
}

function tablist() {
  return screen.getByRole("tablist", { name: /Menu sections/ });
}

describe("Ticket detail POS layout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("groups the menu under section headings and offers a category rail", async () => {
    await renderPos();

    // Every section is reachable from the rail, including the uncategorised one
    // whose id is null.
    const rail = within(tablist());
    for (const name of ["All", "Starters", "Mains", "Uncategorised"]) {
      expect(rail.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }

    // "All" shows the section headings rather than one flat grid.
    expect(screen.getByRole("heading", { name: "Starters" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mains" })).toBeInTheDocument();
  });

  it("narrows the grid to the tapped section", async () => {
    await renderPos();

    fireEvent.click(within(tablist()).getByRole("tab", { name: /Starters/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Add Steak to order/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Add Soup to order/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Salad to order/ })).toBeInTheDocument();
    expect(within(tablist()).getByRole("tab", { name: /Starters/ })).toHaveAttribute("aria-selected", "true");
  });

  it("selects the uncategorised section instead of falling back to All", async () => {
    await renderPos();

    fireEvent.click(within(tablist()).getByRole("tab", { name: /Uncategorised/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Cola to order/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Add Soup to order/ })).not.toBeInTheDocument();
    expect(within(tablist()).getByRole("tab", { name: /Uncategorised/ })).toHaveAttribute("aria-selected", "true");
  });

  it("counts the dishes already on the ticket on their tile", async () => {
    await renderPos([pendingLine(21, "Steak", 2, 26)]);

    expect(screen.getByLabelText("2 in order")).toBeInTheDocument();
    expect(screen.queryByLabelText("1 in order")).not.toBeInTheDocument();
  });

  it("searching narrows the menu and returns to All", async () => {
    await renderPos();

    fireEvent.click(within(tablist()).getByRole("tab", { name: /Mains/ }));
    fireEvent.change(screen.getByLabelText("Search menu"), { target: { value: "nothing-matches" } });

    // No match in the pinned section would otherwise leave an empty pane.
    await waitFor(() => {
      expect(screen.getByText("No menu items found")).toBeInTheDocument();
    });
    expect(within(tablist()).getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the running total and Send to Kitchen in the order panel", async () => {
    await renderPos([pendingLine(21, "Steak", 2, 26), pendingLine(22, "Fries", 1, 8)]);

    // Two lines but three plates: 2 x Steak + 1 x Fries.
    expect(screen.getByText("3 items")).toBeInTheDocument();

    // The running total lives in the order panel, not only on the pay button.
    const orderPanel = screen.getByRole("region", { name: "Ticket order" });
    const totalRow = within(orderPanel).getByText("Total").parentElement!;
    expect(totalRow).toHaveTextContent("$60.00");

    postMock.mockResolvedValue({ data: openTicket() });
    fireEvent.click(within(orderPanel).getByRole("button", { name: /Send to Kitchen/ }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/tickets/7/send");
    });
  });

  it("shows each dish as a photo card with name, SKU and price", async () => {
    await renderPos();

    // The whole card is the add target, matching the SaleForm product grid.
    const card = screen.getByRole("button", { name: /Add Soup to order/ });
    const photo = card.querySelector("img")!;

    // Decorative alt keeps screen readers on the button's own label.
    expect(photo).toHaveAttribute("alt", "");
    expect(photo.getAttribute("src")).toBeTruthy();
    expect(card).toHaveTextContent("Soup");
    expect(card).toHaveTextContent("MNU-11");
    expect(card).toHaveTextContent("$6.00");
  });

  it("keeps an explicit Add action and a separate details action on every dish", async () => {
    await renderPos();

    // The footer Add button is distinct from the card body but shares the intent.
    expect(screen.getAllByRole("button", { name: "Add" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "View Soup details" })).toBeInTheDocument();

    // Details opens the menu product slide-over rather than adding the dish.
    fireEvent.click(screen.getByRole("button", { name: "View Soup details" }));
    expect(await screen.findByRole("dialog", { name: "Soup" })).toBeInTheDocument();
  });

  it("adds a dish through the tile and steps its quantity on the order line", async () => {
    await renderPos([pendingLine(21, "Steak", 1, 26)]);
    postMock.mockResolvedValue({ data: {} });

    // The tile opens the modifier drawer rather than posting straight away, so
    // quantity and options can be chosen before the line lands.
    fireEvent.click(screen.getByRole("button", { name: /Add Soup to order/ }));
    const drawer = await screen.findByRole("button", { name: "Add to Order" });
    fireEvent.click(drawer);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/tickets/7/items", {
        product_id: 11,
        quantity: 1,
      });
    });

    putMock.mockResolvedValue({ data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Increase Steak" }));
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/restaurant/tickets/7/items/21", { quantity: 2 });
    });
  });
});
