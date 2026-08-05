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

function mockGet(checks: ReturnType<typeof mockQC>[] = [], products: ReturnType<typeof mockProduct>[] = [], lots: Record<string, unknown>[] = []) {
  getMock.mockImplementation((url: string) => {
    if (url === "/quality-checks") return Promise.resolve({ data: { items: checks, total: checks.length, page: 1, pages: 1 } });
    if (url === "/products") return Promise.resolve({ data: { items: products, total: products.length, page: 1, pages: 1 } });
    if (url === "/lots") return Promise.resolve({ data: { items: lots, total: lots.length, page: 1, pages: 1 } });
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

  it("creates a failing check and posts the payload", async () => {
    mockGet([], [mockProduct()], [{ id: 5, lot_number: "LOT-5", status: "in_stock", on_hand: 4 }]);
    postMock.mockResolvedValue({ data: { qc_number: "QC-0002" } });
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByRole("button", { name: "New Check" }));
    expect(await screen.findByText("Widget (SKU-001)")).toBeInTheDocument();

    const combos = screen.getAllByRole("combobox");
    fireEvent.change(combos[1], { target: { value: "1" } });
    await waitFor(() => expect(screen.getByText(/LOT-5/)).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "5" } });
    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "fail" } });
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

  it("warns when failing without a linked lot", async () => {
    mockGet([], [mockProduct()], []);
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByRole("button", { name: "New Check" }));
    await screen.findByText("Widget (SKU-001)");

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "1" } });
    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "fail" } });
    expect(screen.getByText(/Failing without a linked lot will block shipments/)).toBeInTheDocument();
  });

  it("edits an existing check and disables immutable fields", async () => {
    mockGet([mockQC()], [mockProduct()], [{ id: 1, lot_number: "LOT-0001", status: "in_stock", on_hand: 4 }]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByLabelText("Edit QC-0001"));
    expect(await screen.findByText("Edit QC-0001")).toBeInTheDocument();

    const combos = screen.getAllByRole("combobox");
    expect((combos[1] as HTMLSelectElement).disabled).toBe(true);
    expect((combos[2] as HTMLSelectElement).disabled).toBe(true);

    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/quality-checks/1", { result: "pass", notes: "off spec" }));
  });

  it("deletes a check after confirmation", async () => {
    mockGet([mockQC()]);
    deleteMock.mockResolvedValue({ data: {} });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<QualityChecks />);
    fireEvent.click(await screen.findByLabelText("Delete QC-0001"));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/quality-checks/1"));
  });
});
