import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Customers from "../pages/Customers";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockCustomers(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/customers") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Customers Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders customer rows with type badge", async () => {
    mockCustomers([{ id: 1, name: "Bob", phone: "555-0111", email: "bob@example.com", customer_type: "frequent", notes: "Regular buyer", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Customers />);
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("555-0111")).toBeInTheDocument();
    expect(screen.getByText("frequent")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by type")).toBeInTheDocument();
  });

  it("deletes a customer through the confirm dialog", async () => {
    mockCustomers([{ id: 1, name: "Bob", phone: "555-0111", email: "bob@example.com", customer_type: "walk-in", notes: "", created_at: "2026-01-01T00:00:00" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Customers />);
    fireEvent.click(await screen.findByLabelText("Delete Bob"));
    expect(screen.getByText(/Are you sure you want to deactivate "Bob"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/customers/1"));
  });

  it("shows empty state when no customers", async () => {
    mockCustomers([]);
    renderWithProviders(<Customers />);
    expect(await screen.findByText("No customers found")).toBeInTheDocument();
  });
});
