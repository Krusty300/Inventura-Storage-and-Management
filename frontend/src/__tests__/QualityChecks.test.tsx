import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import QualityChecks from "../pages/QualityChecks";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockQC(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    qc_number: "QC-0001",
    product_id: 1,
    lot_id: 1,
    work_order_id: null,
    batch_number: "B-2026-01",
    result: "fail",
    notes: "off spec",
    checked_by: 1,
    checked_at: "2026-01-02T10:00:00Z",
    created_at: "2026-01-01T10:00:00Z",
    product_name: "Widget",
    lot_number: "LOT-0001",
    wo_number: "",
    checker_username: "admin",
    ...overrides,
  };
}

function mockProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    is_variant: false,
    is_serialized: false,
    variants: [],
    display_name: "Widget",
    sku: "SKU-001",
    ...overrides,
  };
}

function mockGet(checks: ReturnType<typeof mockQC>[] = [], products: ReturnType<typeof mockProduct>[] = [], lots: Record<string, unknown>[] = [], stockLocations: Record<string, unknown>[] = []) {
  getMock.mockImplementation((url: string) => {
    if (url === "/quality-checks") return Promise.resolve({ data: { items: checks, total: checks.length, page: 1, pages: 1 } });
    if (url === "/products") return Promise.resolve({ data: { items: products, total: products.length, page: 1, pages: 1 } });
    if (url === "/lots") return Promise.resolve({ data: { items: lots, total: lots.length, page: 1, pages: 1 } });
    if (url === "/stock-movements/locations") return Promise.resolve({ data: { locations: stockLocations, unallocated: 0 } });
    if (url === "/serial-numbers") return Promise.resolve({ data: { items: [] } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("QualityChecks Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders QC rows with result badges", async () => {
    mockGet([mockQC()]);
    renderWithProviders(<QualityChecks />);
    expect(await screen.findByText("QC-0001")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("B-2026-01")).toBeInTheDocument();
    expect(screen.getByText("LOT-0001")).toBeInTheDocument();
    expect(screen.getByText("fail")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("shows edit and delete actions for admins", async () => {
    mockGet([mockQC()]);
    renderWithProviders(<QualityChecks />);
    expect(await screen.findByText("QC-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Check" })).toBeInTheDocument();
    expect(screen.getByLabelText("Edit QC-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete QC-0001")).toBeInTheDocument();
  });

  it("hides edit and delete actions for workers", async () => {
    mockGet([mockQC()]);
    renderWithProviders(<QualityChecks />, { role: "worker" });
    expect(await screen.findByText("QC-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit QC-0001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete QC-0001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("View QC-0001")).toBeInTheDocument();
  });

  it("shows empty state when no checks", async () => {
    mockGet([]);
    renderWithProviders(<QualityChecks />);
    expect(await screen.findByText("No quality checks yet")).toBeInTheDocument();
  });

  it("sends a debounced search query", async () => {
    mockGet([mockQC()]);
    renderWithProviders(<QualityChecks />);
    expect(await screen.findByText("QC-0001")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search quality checks"), { target: { value: "Widget" } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/quality-checks", expect.objectContaining({ params: expect.objectContaining({ search: "Widget" }) }))
    );
  });

  it("creates a failing check and posts the payload", async () => {
    mockGet([], [mockProduct()], [{ id: 5, lot_number: "LOT-5", status: "in_stock", on_hand: 4 }]);
    postMock.mockResolvedValue({ data: { qc_number: "QC-0002" } });
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByRole("button", { name: "New Check" }));
    expect(await screen.findByText("Widget (SKU-001)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("QC product"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByText(/LOT-5/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("QC lot"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("QC result"), { target: { value: "fail" } });
    expect(screen.getByText(/Failing this check will quarantine the linked lot/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/quality-checks", {
      product_id: 1,
      batch_number: "",
      result: "fail",
      notes: "",
      lot_id: 5,
    }));
  });

  it("records the selected stock location when creating a check", async () => {
    mockGet(
      [],
      [mockProduct({ id: 2, display_name: "Gadget", sku: "SKU-2" })],
      [
        { id: 5, lot_number: "LOT-5", status: "in_stock", on_hand: 4, locations: ["Main / Aisle 1"] },
        { id: 6, lot_number: "LOT-6", status: "in_stock", on_hand: 9, locations: ["Main / Aisle 2"] },
      ],
      [
        { location_id: 10, path: "Main / Aisle 1", is_active: true, quantity: 4, lots: [] },
        { location_id: 11, path: "Main / Aisle 2", is_active: true, quantity: 9, lots: [] },
      ]
    );
    postMock.mockResolvedValue({ data: { qc_number: "QC-0003" } });
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByRole("button", { name: "New Check" }));
    expect(await screen.findByText("Gadget (SKU-2)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("QC product"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /Main \/ Aisle 1 \(4 on hand\)/ })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("QC location"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByText(/Pick a location to narrow the lot list/)).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /LOT-5 \(4 on hand\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /LOT-6/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("QC lot"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("QC result"), { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/quality-checks", {
      product_id: 2,
      batch_number: "",
      result: "pass",
      notes: "",
      lot_id: 5,
      location_id: 10,
    }));
  });

  it("warns when failing without a linked lot", async () => {
    mockGet([], [mockProduct()], []);
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByRole("button", { name: "New Check" }));
    await screen.findByText("Widget (SKU-001)");

    fireEvent.change(screen.getByLabelText("QC product"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("QC result"), { target: { value: "fail" } });
    expect(screen.getByText(/Failing without a linked lot will block shipments/)).toBeInTheDocument();
  });

  it("edits an existing check and disables immutable fields", async () => {
    mockGet([mockQC()], [mockProduct()], [{ id: 1, lot_number: "LOT-0001", status: "in_stock", on_hand: 4 }]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByLabelText("Edit QC-0001"));
    expect(await screen.findByText("Edit QC-0001")).toBeInTheDocument();

    expect((screen.getByLabelText("QC product") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("QC lot") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("QC location") as HTMLSelectElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("QC result"), { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/quality-checks/1", { result: "pass", notes: "off spec" }));
  });

  it("shows serialized products with a marker and serial-based lot counts", async () => {
    mockGet(
      [],
      [mockProduct({ id: 7, display_name: "Asset", sku: "SKU-7", is_serialized: true })],
      [{ id: 9, lot_number: "LOT-9", status: "in_stock", on_hand: 0, serial_count: 5 }]
    );
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByRole("button", { name: "New Check" }));
    expect(await screen.findByRole("option", { name: "Asset (SKU-7) (Serialized)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("QC product"), { target: { value: "7" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /LOT-9 \(5 on hand\)/ })).toBeInTheDocument());
  });

  it("deletes a check through the confirm dialog", async () => {
    mockGet([mockQC()]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByLabelText("Delete QC-0001"));
    expect(await screen.findByText(/Are you sure you want to delete quality check QC-0001/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/quality-checks/1"));
  });
});
