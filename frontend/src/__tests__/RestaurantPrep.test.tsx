import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import RestaurantPrep from "../pages/restaurant/RestaurantPrep";
import api from "../api/client";
import { renderWithProviders } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: { currency_symbol: "$", tax_rate: 0 } }),
}));

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

function station(overrides: Record<string, unknown> = {}) {
  return {
    station: "Grill",
    par_qty: 0,
    items: [
      { product_id: 11, name: "Ribeye", station: "Grill", par_qty: 10, warn_qty: 4, available_qty: 6, sold_qty: 4, is_below_warn: false },
      { product_id: 12, name: "Chicken", station: "Grill", par_qty: 8, warn_qty: 4, available_qty: 2, sold_qty: 6, is_below_warn: true },
    ],
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    session_number: "PREP-0003",
    station: "Grill",
    user_id: 2,
    username: "sam",
    status: "open",
    notes: "",
    opened_at: "2026-01-01T10:00:00Z",
    closed_at: null,
    closed_by: null,
    closed_by_username: "",
    prepped_qty: 20,
    sold_qty: 10,
    waste_qty: 0,
    expected_remaining: 10,
    variance: 0,
    item_count: 2,
    items: [
      { id: 1, product_id: 11, product_name: "Ribeye", prepped_qty: 12, sold_qty: 4, waste_qty: 0, counted_qty: null, expected_remaining: 8, variance: null, waste_reason: "", created_at: "2026-01-01T10:05:00Z" },
      { id: 2, product_id: 12, product_name: "Chicken", prepped_qty: 8, sold_qty: 6, waste_qty: 0, counted_qty: null, expected_remaining: 2, variance: null, waste_reason: "", created_at: "2026-01-01T10:05:00Z" },
    ],
    created_at: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

function render(role = "admin") {
  return renderWithProviders(
    <Routes>
      <Route path="/restaurant/prep" element={<RestaurantPrep />} />
    </Routes>,
    { route: "/restaurant/prep", role },
  );
}

describe("RestaurantPrep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/prep/stations") return Promise.resolve({ data: [station()] });
      if (url === "/restaurant/prep/sessions") return Promise.resolve({ data: [session()] });
      return Promise.resolve({ data: [] });
    });
  });

  it("shows what is on the pass and flags dishes under the warn level", async () => {
    render();
    expect((await screen.findAllByText("Ribeye")).length).toBeGreaterThan(0);
    expect(screen.getByText("low (warn 4)")).toBeInTheDocument();
    expect(screen.getByText("Below warn level")).toBeInTheDocument();
  });

  it("records a batch against the open session", async () => {
    postMock.mockResolvedValue({ data: session() });
    render();
    await screen.findAllByText("Ribeye");

    fireEvent.click(screen.getAllByRole("button", { name: "+5" })[0]);
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/prep/sessions/3/items", {
        product_id: 11,
        quantity: 5,
      });
    });
  });

  it("offers no batch buttons until a session is open", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/prep/stations") return Promise.resolve({ data: [station()] });
      if (url === "/restaurant/prep/sessions") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    render();
    expect(await screen.findByRole("button", { name: /Start Grill session/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+5" })).not.toBeInTheDocument();
  });

  it("explains the setup when no dish sits on a prep station", async () => {
    getMock.mockResolvedValue({ data: [] });
    render();
    expect(await screen.findByText("No dishes on a prep station")).toBeInTheDocument();
    expect(screen.getByText(/Assign a prep station to a menu item/)).toBeInTheDocument();
  });

  it("still lets a session with no batches be closed as empty", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/prep/stations") return Promise.resolve({ data: [station()] });
      if (url === "/restaurant/prep/sessions") {
        return Promise.resolve({ data: [session({ item_count: 0, items: [] })] });
      }
      return Promise.resolve({ data: [] });
    });
    postMock.mockResolvedValue({ data: session({ status: "closed" }) });
    render();
    expect(await screen.findByText(/nothing to count/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review and close" }));
    const dialog = await screen.findByRole("dialog", { name: /Close PREP-0003/ });
    expect(within(dialog).getByText(/closes as an empty session/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close session" }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/prep/sessions/3/close", { counted: [] });
    });
  });

  it("explains the session history when nothing has been closed", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/restaurant/prep/stations") return Promise.resolve({ data: [station()] });
      if (url === "/restaurant/prep/sessions") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    render();
    expect(await screen.findByText("No sessions closed yet")).toBeInTheDocument();
  });

  it("will not book waste without a reason", async () => {
    postMock.mockResolvedValue({ data: session() });
    render();
    await screen.findAllByText("Ribeye");

    fireEvent.click(screen.getByRole("button", { name: "Record waste for Ribeye" }));
    const dialog = await screen.findByRole("dialog", { name: "Record waste" });
    expect(within(dialog).getByRole("button", { name: "Record waste" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "burnt" } });
    expect(within(dialog).getByRole("button", { name: "Record waste" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Record waste" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/prep/sessions/3/waste", {
        product_id: 11,
        quantity: 1,
        reason: "burnt",
      });
    });
  });

  it("counts the pass and shows the variance before closing", async () => {
    postMock.mockResolvedValue({ data: session({ status: "closed", closed_at: "2026-01-01T14:00:00Z", closed_by_username: "sam", variance: -1 }) });
    render();
    await screen.findAllByText("Ribeye");

    fireEvent.change(screen.getByLabelText("Counted Ribeye"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Counted Chicken"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and close" }));

    const dialog = await screen.findByRole("dialog", { name: /Close PREP-0003/ });
    // Ribeye expects 8 and is counted at 7, so one plate is unaccounted for.
    expect(within(dialog).getByText("-1")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close session" }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/restaurant/prep/sessions/3/close", {
        counted: [
          { product_id: 11, counted_qty: 7 },
          { product_id: 12, counted_qty: 2 },
        ],
      });
    });
  });

  it("hides prep level editing from a waiter", async () => {
    render("worker");
    await screen.findAllByText("Ribeye");
    expect(screen.queryByRole("button", { name: "Prep levels for Ribeye" })).not.toBeInTheDocument();
  });

  it("lets a manager set the par and warn levels", async () => {
    putMock.mockResolvedValue({ data: { product_id: 11, name: "Ribeye", station: "Grill", par_qty: 12, warn_qty: 3 } });
    render();
    await screen.findAllByText("Ribeye");

    fireEvent.click(screen.getByRole("button", { name: "Prep levels for Ribeye" }));
    const dialog = await screen.findByRole("dialog", { name: "Prep levels" });
    fireEvent.change(within(dialog).getByLabelText("Par level"), { target: { value: "12" } });
    fireEvent.change(within(dialog).getByLabelText("Warn level"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save levels" }));

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/restaurant/prep/menu-items/11", {
        prep_station: "Grill",
        par_qty: 12,
        warn_qty: 3,
      });
    });
  });

  it("blocks saving a warn level above the par level", async () => {
    render();
    await screen.findAllByText("Ribeye");

    fireEvent.click(screen.getByRole("button", { name: "Prep levels for Ribeye" }));
    const dialog = await screen.findByRole("dialog", { name: "Prep levels" });
    fireEvent.change(within(dialog).getByLabelText("Par level"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Warn level"), { target: { value: "9" } });
    expect(within(dialog).getByRole("button", { name: "Save levels" })).toBeDisabled();
  });
});
