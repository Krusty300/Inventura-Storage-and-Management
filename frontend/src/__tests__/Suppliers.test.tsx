import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Suppliers from "../pages/Suppliers";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockSuppliers(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/suppliers") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Suppliers Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders supplier rows", async () => {
    mockSuppliers([{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St" }]);
    renderWithProviders(<Suppliers />);
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    expect(screen.getByText("555-0100")).toBeInTheDocument();
  });

  it("deletes a supplier through the confirm dialog", async () => {
    mockSuppliers([{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Suppliers />);
    fireEvent.click(await screen.findByLabelText("Delete Acme Supplies"));
    expect(screen.getByText(/Are you sure you want to deactivate "Acme Supplies"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/suppliers/1"));
  });

  it("shows empty state when no suppliers", async () => {
    mockSuppliers([]);
    renderWithProviders(<Suppliers />);
    expect(await screen.findByText("No suppliers")).toBeInTheDocument();
  });

  it("renders analytics columns and inactive badge", async () => {
    mockSuppliers([{ id: 1, name: "Acme Supplies", contact_person: "Jane", email: "jane@acme.com", phone: "555-0100", address: "1 Main St", is_active: false, total_orders: 3, total_spent: 240, product_count: 5 }]);
    renderWithProviders(<Suppliers />);
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("$240.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Show inactive")).toBeInTheDocument();
    expect(screen.getByLabelText("Restore Acme Supplies")).toBeInTheDocument();
  });
});
