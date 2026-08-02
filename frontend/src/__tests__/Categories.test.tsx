import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Categories from "../pages/Categories";

const getMock = api.get as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockCategories(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/categories") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Categories Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders category rows", async () => {
    mockCategories([{ id: 1, name: "Beverages", description: "Drinks", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Categories />);
    expect(await screen.findByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Drinks")).toBeInTheDocument();
  });

  it("deletes a category through the confirm dialog", async () => {
    mockCategories([{ id: 1, name: "Beverages", description: "Drinks", created_at: "2026-01-01T00:00:00" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Categories />);
    fireEvent.click(await screen.findByLabelText("Delete Beverages"));
    expect(screen.getByText(/Are you sure you want to delete "Beverages"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/categories/1"));
  });

  it("shows empty state when no categories", async () => {
    mockCategories([]);
    renderWithProviders(<Categories />);
    expect(await screen.findByText("No categories")).toBeInTheDocument();
  });
});
