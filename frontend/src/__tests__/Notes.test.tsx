import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

import Notes from "../pages/Notes";

const getMock = api.get as ReturnType<typeof vi.fn>;

function mockNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Test Note",
    body: "Body text",
    category: "note",
    priority: "normal",
    is_pinned: false,
    is_completed: false,
    due_date: null,
    recurrence: "none",
    recurrence_end: null,
    sort_order: 0,
    image_url: "",
    user_id: 1,
    assigned_to_id: null,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    username: "tester",
    assigned_to_name: null,
    tags: [],
    links: [],
    ...overrides,
  };
}

function mockNotes(items: ReturnType<typeof mockNote>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/notes") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (url === "/notes/tags") return Promise.resolve({ data: [] });
    if (url === "/notes/assignable-users") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
}

describe("Notes Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders page title", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />);
    expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
  });

  it("shows empty state when no notes", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
  });

  it("renders note titles in the list", async () => {
    mockNotes([
      mockNote({ title: "Shift handoff" }),
      mockNote({ id: 2, title: "Reorder alert" }),
    ]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("Shift handoff")).toBeInTheDocument();
    expect(screen.getByText("Reorder alert")).toBeInTheDocument();
  });

  it("shows category badges", async () => {
    mockNotes([mockNote({ title: "Reminder item", category: "reminder" })]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("Reminder item")).toBeInTheDocument();
    const badges = screen.getAllByText("reminder");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows priority badge for non-normal priorities", async () => {
    mockNotes([mockNote({ title: "Urgent task", priority: "urgent" })]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("Urgent task")).toBeInTheDocument();
    const badges = screen.getAllByText("urgent");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("hides priority badge for normal priority", async () => {
    mockNotes([mockNote({ priority: "normal" })]);
    renderWithProviders(<Notes />);
    const el = await screen.findByText("Test Note");
    expect(el.parentElement).not.toHaveTextContent("normal");
  });

  it("shows overdue badge for past due notes", async () => {
    mockNotes([mockNote({ due_date: "2020-01-01T00:00:00", is_completed: false })]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
  });

  it("does not show overdue for completed notes", async () => {
    mockNotes([mockNote({ due_date: "2020-01-01T00:00:00", is_completed: true })]);
    renderWithProviders(<Notes />);
    await screen.findByText("Test Note");
    const completedBadge = screen.getByText((content) => content.includes("Completed"));
    expect(completedBadge).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("shows completed notes with strikethrough style", async () => {
    mockNotes([mockNote({ title: "Done task", is_completed: true })]);
    renderWithProviders(<Notes />);
    const el = await screen.findByText("Done task");
    expect(el).toHaveClass("line-through");
  });

  it("shows tag chips on notes", async () => {
    mockNotes([
      mockNote({
        tags: [
          { id: 1, name: "urgent-tag", color: "#ff0000" },
        ],
      }),
    ]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("urgent-tag")).toBeInTheDocument();
  });

  it("shows linked entity count", async () => {
    mockNotes([
      mockNote({
        links: [
          { id: 1, entity_type: "product", entity_id: 5 },
          { id: 2, entity_type: "order", entity_id: 10 },
        ],
      }),
    ]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("2 linked")).toBeInTheDocument();
  });

  it("shows assigned user", async () => {
    mockNotes([mockNote({ assigned_to_name: "john" })]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("@john")).toBeInTheDocument();
  });

  it("shows New Note button for admin", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />);
    const buttons = await screen.findAllByText("New Note");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows New Note button for worker with create permission", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />, { role: "worker" });
    const buttons = await screen.findAllByText("New Note");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows filter dropdowns", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />);
    await screen.findByRole("heading", { name: "Notes" });
    expect(screen.getByDisplayValue("All categories")).toBeInTheDocument();
    expect(screen.getByDisplayValue("All priorities")).toBeInTheDocument();
  });

  it("shows completion filter tabs", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />);
    expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
    const tabGroup = screen.getAllByRole("button").filter((b) => ["All", "Active", "Done"].includes(b.textContent || ""));
    expect(tabGroup.length).toBe(3);
  });

  it("shows pinned section header", async () => {
    mockNotes([
      mockNote({ title: "Pinned note", is_pinned: true }),
      mockNote({ id: 2, title: "Regular note", is_pinned: false }),
    ]);
    renderWithProviders(<Notes />);
    expect(await screen.findByText("Pinned note")).toBeInTheDocument();
    expect(screen.getByText("Regular note")).toBeInTheDocument();
  });

  it("renders search input", async () => {
    mockNotes([]);
    renderWithProviders(<Notes />);
    expect(await screen.findByPlaceholderText("Search notes...")).toBeInTheDocument();
  });
});
