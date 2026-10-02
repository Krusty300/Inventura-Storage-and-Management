import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import WorkCenters from "../pages/WorkCenters";

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

const CENTER = {
  id: 1,
  code: "CNC-1",
  name: "CNC Mill 1",
  work_center_type: "machine",
  location_id: null,
  hours_per_day: 8,
  working_days: [0, 1, 2, 3, 4],
  shift_start: "08:00",
  efficiency: 90,
  hourly_rate: 45,
  notes: "",
  is_active: true,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  location_name: "",
  working_day_list: [0, 1, 2, 3, 4],
  daily_minutes: 480,
  operation_count: 2,
};

const LOAD = {
  work_center_id: 1,
  work_center_code: "CNC-1",
  work_center_name: "CNC Mill 1",
  from_date: "2026-01-01",
  to_date: "2026-01-07",
  working_days_available: 5,
  capacity_minutes: 2400,
  load_minutes: 2400,
  free_minutes: 0,
  utilization_pct: 100,
  scheduled_work_orders: 3,
  open_work_orders: 4,
  is_bottleneck: true,
  overdue_work_orders: 1,
};

const ROUTING = {
  product_id: 5,
  product_name: "Widget",
  sku: "W-1",
  operation_count: 1,
  total_setup_minutes: 10,
  total_run_minutes_per_unit: 2,
  unique_work_centers: 1,
  ideal_minutes_per_unit: 12,
  adjusted_minutes_per_unit: 13.3,
  is_complete: true,
  operations: [
    {
      id: 1,
      product_id: 5,
      work_center_id: 1,
      position: 0,
      name: "Cut",
      setup_minutes: 10,
      run_minutes_per_unit: 2,
      notes: "",
      is_active: true,
      created_at: "2026-01-01T00:00:00",
      work_center_name: "CNC Mill 1",
      work_center_code: "CNC-1",
      label: "Step 1",
    },
  ],
};

function mockApi({ centers = [CENTER], load = [LOAD], routings = [ROUTING] }: {
  centers?: Record<string, unknown>[];
  load?: Record<string, unknown>[];
  routings?: unknown[];
} = {}) {
  getMock.mockImplementation((url: string) => {
    if (url === "/work-centers") return Promise.resolve({ data: { items: centers, total: centers.length, page: 1, pages: 1 } });
    if (url === "/work-centers/load") return Promise.resolve({ data: load });
    if (url === "/locations") return Promise.resolve({ data: { items: [], total: 0, page: 1, pages: 1 } });
    if (url === "/routings/products") return Promise.resolve({ data: routings });
    if (url === "/settings") return Promise.resolve({ data: { currency_symbol: "$" } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Work Centers Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders work centers with their load", async () => {
    mockApi();
    renderWithProviders(<WorkCenters />);
    expect(await screen.findByText("CNC Mill 1")).toBeInTheDocument();
    expect(screen.getByText("CNC-1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Bottleneck")).toBeInTheDocument();
    expect(screen.getByText("1 late")).toBeInTheDocument();
  });

  it("shows the empty state when there are no work centers", async () => {
    mockApi({ centers: [] });
    renderWithProviders(<WorkCenters />);
    expect(await screen.findByText("No work centers yet")).toBeInTheDocument();
  });

  it("deletes a work center through the confirm dialog", async () => {
    mockApi();
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<WorkCenters />);
    fireEvent.click(await screen.findByLabelText("Delete CNC Mill 1"));
    expect(screen.getByText(/Are you sure you want to delete "CNC Mill 1"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/work-centers/1"));
  });

  it("lists product routings and saves an edit", async () => {
    mockApi();
    putMock.mockResolvedValue({ data: ROUTING });
    renderWithProviders(<WorkCenters />);
    fireEvent.click(await screen.findByRole("button", { name: "Routings" }));
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("12m")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Edit routing for Widget"));
    const runInput = await screen.findByLabelText("Step 1 run minutes per unit");
    fireEvent.change(runInput, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Routing" }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/routings/products/5", {
        operations: [
          { work_center_id: 1, position: 0, name: "Cut", setup_minutes: 10, run_minutes_per_unit: 5, notes: "", is_active: true },
        ],
      }),
    );
  });

  it("opens a detail slide-over from the row and shows capacity", async () => {
    mockApi();
    renderWithProviders(<WorkCenters />);
    const row = (await screen.findByText("CNC Mill 1")).closest("tr")!;
    fireEvent.click(row);

    const dialog = await screen.findByRole("dialog", { name: "CNC Mill 1" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Capacity & load")).toBeInTheDocument();
    // The window is fully loaded: 2400 capacity minutes against 2400 booked,
    // which leaves nothing free and flags the center as a bottleneck.
    expect(screen.getByText("0m")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "Utilization of CNC Mill 1");
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
  });

  it("hands off from the detail slide-over to the edit form", async () => {
    mockApi();
    putMock.mockResolvedValue({ data: CENTER });
    renderWithProviders(<WorkCenters />);
    fireEvent.click(await screen.findByLabelText("View CNC Mill 1"));

    fireEvent.click(await screen.findByRole("button", { name: "Edit work center" }));
    expect(await screen.findByRole("dialog", { name: "Edit CNC-1: CNC Mill 1" })).toBeInTheDocument();

    const efficiency = screen.getByLabelText("Efficiency percent");
    fireEvent.change(efficiency, { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Work Center" }));

    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/work-centers/1", expect.objectContaining({ efficiency: 95 })));
  });

  it("toggles working days from the form slide-over", async () => {
    mockApi();
    putMock.mockResolvedValue({ data: CENTER });
    renderWithProviders(<WorkCenters />);
    fireEvent.click(await screen.findByLabelText("View CNC Mill 1"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit work center" }));

    const sunday = await screen.findByRole("button", { name: "Sunday" });
    expect(sunday).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sunday);
    expect(sunday).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Update Work Center" }));
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/work-centers/1", expect.objectContaining({ working_days: [0, 1, 2, 3, 4, 6] })),
    );
  });
});
