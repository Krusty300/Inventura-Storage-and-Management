import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import SerialNumbers from "../pages/SerialNumbers";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockSerial(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    product_id: 1,
    serial_number: "SN-0001",
    lot_id: 1,
    location_id: 2,
    status: "in_stock",
    sold_at: null,
    created_at: "2026-01-01T10:00:00",
    product_name: "Widget",
    lot_number: "LOT-0001",
    location_name: "Aisle A",
    ...overrides,
  };
}

function mockSerials(items: ReturnType<typeof mockSerial>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/serial-numbers") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (url === "/serial-numbers/1/movements") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("SerialNumbers Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders serial rows with details from the API", async () => {
    mockSerials([mockSerial()]);
    renderWithProviders(<SerialNumbers />);
    expect(await screen.findByText("SN-0001")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("LOT-0001")).toBeInTheDocument();
    expect(screen.getByText("Aisle A")).toBeInTheDocument();
    expect(screen.getByText("in_stock")).toBeInTheDocument();
  });

  it("shows empty state when no serial numbers", async () => {
    mockSerials([]);
    renderWithProviders(<SerialNumbers />);
    expect(await screen.findByText("No serial numbers yet")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    getMock.mockImplementation((url: string, config?: any) => {
      if (url === "/serial-numbers") {
        const rows = config?.params?.status === "sold" ? [mockSerial({ id: 2, serial_number: "SN-0002", status: "sold", sold_at: "2026-02-01T10:00:00" })] : [mockSerial()];
        return Promise.resolve({ data: { items: rows, total: rows.length, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SerialNumbers />);
    expect(await screen.findByText("SN-0001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sold" }));
    expect(await screen.findByText("SN-0002")).toBeInTheDocument();
    expect(screen.queryByText("SN-0001")).not.toBeInTheDocument();
  });

  it("opens the detail modal with movements", async () => {
    mockSerials([mockSerial()]);
    renderWithProviders(<SerialNumbers />);
    fireEvent.click(await screen.findByLabelText("View SN-0001"));
    expect(await screen.findByText("Serial SN-0001")).toBeInTheDocument();
    expect(await screen.findByText(/No movements recorded for this serial number/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/serial-numbers/1/movements");
  });
});
