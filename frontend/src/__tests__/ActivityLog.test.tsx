import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import ActivityLog from "../pages/ActivityLog";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockLogs(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/activity-logs") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("ActivityLog Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders activity log rows", async () => {
    mockLogs([{ id: 1, user_id: 1, username: "tester", action: "create", entity_type: "product", entity_id: 1, description: "Created Product Widget", details: "", created_at: "2026-01-01T10:00:00" }]);
    renderWithProviders(<ActivityLog />);
    expect(await screen.findByText("Created Product Widget")).toBeInTheDocument();
    expect(screen.getByText("tester")).toBeInTheDocument();
    expect(screen.getByText("create")).toBeInTheDocument();
  });

  it("shows the entity and action filters", async () => {
    mockLogs([]);
    renderWithProviders(<ActivityLog />);
    expect(await screen.findByText("No activity recorded")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by entity")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by action")).toBeInTheDocument();
  });
});
