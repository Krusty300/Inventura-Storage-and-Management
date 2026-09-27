import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import RestaurantReservations from "../pages/restaurant/RestaurantReservations";
import api from "../api/client";
import { renderWithProviders } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: { currency_symbol: "$" } }),
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;

function table(id: number, number: string, capacity = 4) {
  return { id, number, capacity, status: "free", zone: "Main", is_active: true };
}

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    reservation_number: "R-0003",
    guest_name: "Alice Banda",
    guest_phone: "0700000000",
    guest_count: 2,
    table_id: 1,
    table_number: "T-1",
    reserved_at: "2026-02-01T18:30:00Z",
    duration_minutes: 90,
    status: "confirmed",
    notes: "",
    created_at: "2026-02-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(<RestaurantReservations />, { route: "/restaurant/reservations" });
}

async function openNewForm() {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "New Reservation" }));
  return screen.findByRole("dialog", { name: "New Reservation" });
}

describe("RestaurantReservations shared form controls", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/reservations") return Promise.resolve({ data: { items: [reservation()], total: 1, pages: 1 } });
      if (url === "/restaurant/tables") return Promise.resolve({ data: [table(1, "T-1"), table(2, "T-2", 6)] });
      return Promise.resolve({ data: [] });
    });
  });

  it("filters by day through the shared date picker instead of a native date input", async () => {
    renderPage();
    const filter = await screen.findByRole("combobox", { name: "Filter by date" });
    expect(filter).toHaveAttribute("readonly");
    expect(document.querySelector('input[type="date"]')).toBeNull();

    fireEvent.change(filter, { target: { value: "" } });
    fireEvent.click(filter);
    fireEvent.click(await screen.findByRole("button", { name: "Today" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/restaurant/reservations", expect.objectContaining({ params: expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }) })));
  });

  it("books a table with a date-time picker and a fitted table select", async () => {
    postMock.mockResolvedValue({ data: reservation() });
    const dialog = await openNewForm();

    const when = within(dialog).getByRole("combobox", { name: "Booking time" });
    expect(within(dialog).queryByLabelText("When *")).toBeNull();
    expect((when as HTMLInputElement).value).toMatch(/\d{2}:\d{2}/);

    const tableSelect = within(dialog).getByRole("combobox", { name: "Table" });
    expect(tableSelect).toHaveValue("No table");
    fireEvent.click(tableSelect);
    fireEvent.click(await screen.findByRole("option", { name: "T-2 — seats 6" }));

    fireEvent.change(within(dialog).getByLabelText("Guest name *"), { target: { value: "Grace Hopper" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [url, payload] = postMock.mock.calls[0];
    expect(url).toBe("/restaurant/reservations");
    expect(payload).toMatchObject({ guest_name: "Grace Hopper", guest_count: 2, table_id: 2, duration_minutes: 90 });
    expect(payload.reserved_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
