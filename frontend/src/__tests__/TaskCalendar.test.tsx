import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import type { Note } from "../types";
import TaskCalendar from "../components/TaskCalendar";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 1,
    title: "Note title",
    body: "Body text",
    category: "note",
    priority: "normal",
    is_pinned: false,
    is_completed: false,
    is_archived: false,
    due_date: "2026-06-15T09:00",
    recurrence: "none",
    recurrence_end: null,
    sort_order: 0,
    image_url: "",
    user_id: 1,
    assigned_to_id: null,
    created_at: "2026-06-01T00:00:00",
    updated_at: "2026-06-01T00:00:00",
    username: "tester",
    assigned_to_name: null,
    tags: [],
    links: [],
    ...overrides,
  };
}

function renderCalendar(notes: Note[]) {
  return renderWithProviders(
    <TaskCalendar
      notes={notes}
      month={new Date(2026, 5, 1)}
      onMonthChange={() => {}}
      onOpenNote={() => {}}
      onReschedule={() => {}}
      onExport={() => {}}
    />,
  );
}

describe("TaskCalendar hover card", () => {
  it("shows the note image when the note has one", async () => {
    renderCalendar([makeNote({ image_url: "https://example.com/shot.png" })]);

    fireEvent.mouseEnter(screen.getByTitle("Note title"));

    const card = await screen.findByRole("tooltip");
    const img = card.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/shot.png");
  });

  it("does not render an image when the note has none", async () => {
    renderCalendar([makeNote({ image_url: "" })]);

    fireEvent.mouseEnter(screen.getByTitle("Note title"));

    const card = await screen.findByRole("tooltip");
    expect(card.querySelector("img")).toBeNull();
  });
});