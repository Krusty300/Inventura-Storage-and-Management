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
    expect(screen.getByText("in stock")).toBeInTheDocument();
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

  it("renders a badge for sold serial numbers", async () => {
    mockSerials([mockSerial({ status: "sold", sold_at: "2026-02-01T10:00:00" })]);
    renderWithProviders(<SerialNumbers />);
    expect(await screen.findByText("sold")).toBeInTheDocument();
    expect(document.querySelector(".badge-neutral")).toBeInTheDocument();
  });

  it("filters and badges inactive serial numbers", async () => {
    getMock.mockImplementation((url: string, config?: any) => {
      if (url === "/serial-numbers") {
        const rows = config?.params?.status === "inactive" ? [mockSerial({ id: 3, serial_number: "SN-0003", status: "inactive" })] : [mockSerial()];
        return Promise.resolve({ data: { items: rows, total: rows.length, page: 1, pages: 1 } });
      }
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SerialNumbers />);
    expect(await screen.findByText("SN-0001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inactive" }));
    expect(await screen.findByText("SN-0003")).toBeInTheDocument();
    expect(document.querySelector(".badge-neutral")).toBeInTheDocument();
  });

  it("deactivates an in-stock serial from the detail modal", async () => {
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: mockSerial({ status: "inactive" }) });
    mockSerials([mockSerial()]);
    renderWithProviders(<SerialNumbers />);
    fireEvent.click(await screen.findByLabelText("View SN-0001"));
    expect(await screen.findByText("Serial SN-0001")).toBeInTheDocument();

    const deactivate = screen.getByRole("button", { name: "Deactivate" });
    fireEvent.click(deactivate);

    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/serial-numbers/1/status", { status: "inactive" }));
    expect(await screen.findByText("inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("releases a quarantined serial from the table row", async () => {
    const putMock = api.put as ReturnType<typeof vi.fn>;
    putMock.mockResolvedValue({ data: {} });
    mockSerials([mockSerial({ status: "quarantined" })]);
    renderWithProviders(<SerialNumbers />);
    fireEvent.click(await screen.findByLabelText("Release SN-0001"));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/serial-numbers/1/status", { status: "in_stock" }));
  });

  it("releases a reserved serial from the table row via the release endpoint", async () => {
    const postMock = api.post as ReturnType<typeof vi.fn>;
    postMock.mockResolvedValue({ data: {} });
    mockSerials([mockSerial({ status: "reserved", reference: "WO-1001" })]);
    renderWithProviders(<SerialNumbers />);
    fireEvent.click(await screen.findByLabelText("Release SN-0001 from work order"));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/serial-numbers/1/release"));
  });

  it("quarantines an in-stock serial by choosing a quarantine area", async () => {
    const postMock = api.post as ReturnType<typeof vi.fn>;
    postMock.mockResolvedValue({ data: { reference: "QAR-0001" } });
    getMock.mockImplementation((url: string) => {
      if (url === "/serial-numbers") return Promise.resolve({ data: { items: [mockSerial()], total: 1, page: 1, pages: 1 } });
      if (url === "/locations") return Promise.resolve({ data: { items: [{ id: 9, path: "Quarantine Area", location_type: "quarantine", is_active: true }], total: 1, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<SerialNumbers />);
    fireEvent.click(await screen.findByLabelText("Quarantine SN-0001"));
    expect(await screen.findByText("Quarantine SN-0001")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Quarantine Area" });
    fireEvent.change(screen.getByLabelText("Quarantine Location"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Quarantine Serial" }));
    await vi.waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/stock-movements/quarantine", {
        product_id: 1,
        serial_ids: [1],
        from_location_id: 2,
        to_location_id: 9,
        quantity: 1,
        notes: "",
      })
    );
  });
});
