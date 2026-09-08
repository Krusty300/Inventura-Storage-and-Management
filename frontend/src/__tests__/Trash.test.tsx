import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Trash from "../pages/Trash";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockTrash(items: Record<string, unknown>[], counts: Record<string, number> = {}) {
  getMock.mockImplementation((url: string) => {
    if (url === "/trash") return Promise.resolve({ data: { items, counts } });
    return Promise.reject(new Error(`Unexpected: ${url}`));
  });
}

describe("Trash Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders empty state when trash is empty", async () => {
    mockTrash([], {});
    renderWithProviders(<Trash />);
    expect(await screen.findByText("Trash is empty")).toBeInTheDocument();
  });

  it("renders trash items in the table", async () => {
    mockTrash(
      [
        { id: 1, entity_type: "category", label: "Beverages", deleted_at: "2026-09-01T10:00:00" },
        { id: 2, entity_type: "supplier", label: "Acme Corp", deleted_at: "2026-09-02T12:00:00" },
      ],
      { category: 1, supplier: 1 }
    );
    renderWithProviders(<Trash />);
    expect(await screen.findByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Suppliers")).toBeInTheDocument();
  });

  it("restores an item when restore button is clicked", async () => {
    mockTrash(
      [{ id: 1, entity_type: "category", label: "Beverages", deleted_at: "2026-09-01T10:00:00" }],
      { category: 1 }
    );
    postMock.mockResolvedValue({ data: { ok: true } });
    renderWithProviders(<Trash />);
    fireEvent.click(await screen.findByLabelText("Restore Beverages"));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/trash/category/1/restore")
    );
  });

  it("opens confirm dialog and permanently deletes an item", async () => {
    mockTrash(
      [{ id: 1, entity_type: "category", label: "Beverages", deleted_at: "2026-09-01T10:00:00" }],
      { category: 1 }
    );
    deleteMock.mockResolvedValue({ data: { ok: true } });
    renderWithProviders(<Trash />);
    fireEvent.click(await screen.findByLabelText("Permanently delete Beverages"));
    expect(screen.getByText(/Are you sure/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Permanently" }));
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("/trash/category/1")
    );
  });

  it("hides action buttons when user lacks trash.restore / trash.delete permissions", async () => {
    mockTrash(
      [{ id: 1, entity_type: "category", label: "Beverages", deleted_at: "2026-09-01T10:00:00" }],
      { category: 1 }
    );
    renderWithProviders(<Trash />, { role: "worker" });
    await screen.findByText("Beverages");
    expect(screen.queryByLabelText("Restore Beverages")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Permanently delete Beverages")).not.toBeInTheDocument();
  });
});
