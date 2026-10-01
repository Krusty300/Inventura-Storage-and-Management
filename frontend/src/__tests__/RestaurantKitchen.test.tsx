import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import RestaurantKitchen from "../pages/restaurant/RestaurantKitchen";
import { ToastProvider } from "../context/ToastContext";
import api from "../api/client";
import { makeQueryClient } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const subscribe = vi.fn(() => () => {});
vi.mock("../context/RealtimeContext", () => ({
  useRealtime: () => ({ subscribe }),
}));

vi.mock("../utils/download", () => ({
  printBlob: vi.fn(),
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

type Item = { id: number; product_id: number; product_name: string; quantity: number; unit_price: number; status: string; modifiers: unknown; notes: string; sent_at: string | null; ready_at: string | null; served_at: string | null };

type TicketOverrides = { items?: Item[] } & Record<string, unknown>;

function ticket(overrides: TicketOverrides = {}) {
  const { items = [], ...rest } = overrides;
  return {
    id: 1,
    ticket_number: "T-0001",
    table_id: 1,
    table_number: "T-1",
    table_zone: "Main",
    guest_count: 2,
    status: "preparing",
    notes: "",
    opened_at: "2026-01-01T10:00:00Z",
    earliest_sent_at: "2026-01-01T10:05:00Z",
    items,
    ...rest,
  };
}

function item(id: number, name: string, status: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    product_id: id,
    product_name: name,
    quantity: 1,
    unit_price: 10,
    status,
    modifiers: null,
    notes: "",
    sent_at: "2026-01-01T10:05:00Z",
    ready_at: status === "ready" || status === "served" ? "2026-01-01T10:12:00Z" : null,
    served_at: status === "served" ? "2026-01-01T10:20:00Z" : null,
    ...extra,
  };
}

const BOARD = [
  ticket({
    id: 1,
    ticket_number: "T-0001",
    table_number: "T-1",
    table_zone: "Main",
    stage: "queued",
    items: [item(1, "Soup", "queued"), item(2, "Not sent", "pending")],
  }),
  ticket({
    id: 2,
    ticket_number: "T-0002",
    table_number: "T-2",
    table_zone: "Bar",
    stage: "preparing",
    items: [item(3, "Steak", "preparing", { notes: "medium rare" })],
  }),
  ticket({
    id: 3,
    ticket_number: "T-0003",
    table_number: "T-3",
    table_zone: "Bar",
    stage: "ready",
    status: "ready",
    items: [item(4, "Pasta", "ready"), item(5, "Salad", "served")],
  }),
];

function renderKitchen() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/restaurant/kitchen"]}>
        <ToastProvider>
          <Routes>
            <Route path="/restaurant/kitchen" element={<RestaurantKitchen />} />
            <Route path="/restaurant/tickets/:id" element={<div>Ticket detail</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stageColumn(label: string): HTMLElement {
  return screen.getByRole("heading", { name: label }).closest("section") as HTMLElement;
}

describe("RestaurantKitchen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    subscribe.mockReturnValue(() => {});
    getMock.mockResolvedValue({ data: BOARD });
    putMock.mockResolvedValue({ data: { id: 1 } });
  });

  it("renders the three stage columns and buckets tickets by stage", async () => {
    renderKitchen();
    await screen.findByText("T-0001");

    expect(within(stageColumn("Queued")).getByText("T-0001")).toBeInTheDocument();
    expect(within(stageColumn("Preparing")).getByText("T-0002")).toBeInTheDocument();
    expect(within(stageColumn("Ready")).getByText("T-0003")).toBeInTheDocument();
  });

  it("hides items that have not been sent to the kitchen yet", async () => {
    renderKitchen();
    await screen.findByText("T-0001");
    expect(screen.queryByText(/Not sent/)).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).toBeInTheDocument();
  });

  it("advances an item through queued, preparing, ready, then served", async () => {
    renderKitchen();
    await screen.findByText("T-0001");
    const queued = within(stageColumn("Queued")).getByRole("button", { name: "Start" });
    fireEvent.click(queued);

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/restaurant/tickets/1/items/1/status", { status: "preparing" });
    });
  });

  it("sends a ready item to served", async () => {
    renderKitchen();
    await screen.findByText("T-0003");
    fireEvent.click(within(stageColumn("Ready")).getByRole("button", { name: "Serve" }));
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/restaurant/tickets/3/items/4/status", { status: "served" });
    });
  });

  it("filters the board by table zone", async () => {
    renderKitchen();
    await screen.findByText("T-0001");

    const combo = screen.getByRole("combobox", { name: "Filter by zone" });
    fireEvent.click(combo);
    fireEvent.click(screen.getByRole("option", { name: "Bar" }));

    await waitFor(() => expect(screen.queryByText("T-0001")).not.toBeInTheDocument());
    expect(screen.getByText("T-0002")).toBeInTheDocument();
    expect(screen.getByText("T-0003")).toBeInTheDocument();
    expect(within(stageColumn("Queued")).getByText("Nothing waiting to be started")).toBeInTheDocument();
  });

  it("shows the empty state when the kitchen has no tickets", async () => {
    getMock.mockResolvedValue({ data: [] });
    renderKitchen();
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("explains an empty zone filter instead of an empty kitchen", async () => {
    renderKitchen();
    await screen.findByText("T-0001");

    fireEvent.click(screen.getByRole("combobox", { name: "Filter by zone" }));
    fireEvent.click(screen.getByRole("option", { name: "Bar" }));
    await waitFor(() => expect(screen.queryByText("T-0001")).not.toBeInTheDocument());

    // The last Bar ticket is served over realtime, leaving the filter with nothing to show.
    getMock.mockResolvedValue({ data: [] });
    const onRealtime = (subscribe.mock.calls as unknown as unknown[][])[0]?.[0] as (msg: { entity: string }) => void;
    act(() => onRealtime({ entity: "restaurant_ticket" }));

    expect(await screen.findByText("No tickets in Bar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("reprints a single item through the item-scoped kitchen ticket", async () => {
    renderKitchen();
    await screen.findByText("T-0001");
    fireEvent.click(screen.getByRole("button", { name: "Reprint Soup" }));
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/restaurant/tickets/1/kitchen", {
        params: { item_ids: "1" },
        responseType: "blob",
      });
    });
  });
});
