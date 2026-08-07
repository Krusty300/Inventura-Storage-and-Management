import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Lots from "../pages/Lots";

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

function mockLot(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    product_id: 1,
    lot_number: "LOT-0001",
    supplier_id: 1,
    expiry_date: "2027-01-01",
    received_date: "2026-01-01",
    status: "in_stock",
    created_at: "2026-01-01T10:00:00",
    product_name: "Widget",
    supplier_name: "Acme",
    on_hand: 12,
    serial_count: 0,
    locations: [],
    ...overrides,
  };
}

function mockLots(items: ReturnType<typeof mockLot>[], status = "") {
  getMock.mockImplementation((url: string, config?: any) => {
    if (url === "/lots") {
      const rows = status && config?.params?.status === status ? items : items;
      return Promise.resolve({ data: { items: rows, total: rows.length, page: 1, pages: 1 } });
    }
    if (url === "/lots/1/movements") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Lots Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders lot rows with details from the API", async () => {
    mockLots([mockLot()]);
    renderWithProviders(<Lots />);
    expect(await screen.findByText("LOT-0001")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("in stock")).toBeInTheDocument();
  });

  it("renders lot locations in the table and detail modal", async () => {
    mockLots([mockLot({ locations: ["Aisle A / Bin A-01"] })]);
    renderWithProviders(<Lots />);
    expect(await screen.findByText("Aisle A / Bin A-01")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("View LOT-0001"));
    expect(await screen.findByText("Lot LOT-0001")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Location")).toBeInTheDocument();
    expect(screen.getAllByText("Aisle A / Bin A-01")).toHaveLength(2);
  });

  it("shows status actions for admins", async () => {
    mockLots([mockLot()]);
    renderWithProviders(<Lots />);
    expect(await screen.findByText("LOT-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Quarantine LOT-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Expire LOT-0001")).toBeInTheDocument();
  });

  it("hides status actions for workers", async () => {
    mockLots([mockLot()]);
    renderWithProviders(<Lots />, { role: "worker" });
    expect(await screen.findByText("LOT-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Quarantine LOT-0001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Expire LOT-0001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("View LOT-0001")).toBeInTheDocument();
  });

  it("shows empty state when no lots", async () => {
    mockLots([]);
    renderWithProviders(<Lots />);
    expect(await screen.findByText("No lots yet")).toBeInTheDocument();
  });

  it("quarantines a lot via the row action", async () => {
    mockLots([mockLot()]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Lots />);
    fireEvent.click(await screen.findByLabelText("Quarantine LOT-0001"));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/1", { status: "quarantined" }));
  });

  it("releases a quarantined lot via the row action", async () => {
    mockLots([mockLot({ id: 2, lot_number: "LOT-0002", status: "quarantined" })]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Lots />);
    fireEvent.click(await screen.findByLabelText("Release LOT-0002"));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/2", { status: "in_stock" }));
  });

  it("marks a lot expired after confirmation", async () => {
    mockLots([mockLot()]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Lots />);
    fireEvent.click(await screen.findByLabelText("Expire LOT-0001"));
    expect(screen.getByText(/Are you sure you want to mark "LOT-0001" as expired/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Expired" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/lots/1", { status: "expired" }));
  });

  it("filters by status", async () => {
    getMock.mockImplementation((url: string, config?: any) => {
      if (url === "/lots") {
        const rows = config?.params?.status === "quarantined" ? [mockLot({ id: 3, lot_number: "LOT-0003", status: "quarantined" })] : [mockLot()];
        return Promise.resolve({ data: { items: rows, total: rows.length, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Lots />);
    expect(await screen.findByText("LOT-0001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quarantined" }));
    expect(await screen.findByText("LOT-0003")).toBeInTheDocument();
    expect(screen.queryByText("LOT-0001")).not.toBeInTheDocument();
  });

  it("opens the detail modal with movements", async () => {
    mockLots([mockLot()]);
    renderWithProviders(<Lots />);
    fireEvent.click(await screen.findByLabelText("View LOT-0001"));
    expect(await screen.findByText("Lot LOT-0001")).toBeInTheDocument();
    expect(await screen.findByText(/No movements recorded for this lot/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/lots/1/movements");
  });
});
