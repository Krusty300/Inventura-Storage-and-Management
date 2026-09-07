import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import {
  buildCalendarEvents,
  buildIcsEvents,
  dateKey,
  expandOccurrences,
  getMonthGrid,
  googleCalUrl,
  outlookCalUrl,
  parseDueDate,
} from "../utils/calendar";

function makeNote(overrides: Record<string, unknown> = {}): Note {
  return {
    id: 1,
    title: "Stock check",
    body: "Count the A1 rack",
    category: "todo",
    priority: "normal",
    is_pinned: false,
    is_completed: false,
    is_archived: false,
    due_date: "2026-09-15T09:00:00",
    recurrence: "none",
    recurrence_end: null,
    sort_order: 0,
    image_url: "",
    user_id: 1,
    assigned_to_id: null,
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    username: "tester",
    assigned_to_name: null,
    tags: [],
    links: [],
    ...overrides,
  };
}

describe("calendar utils", () => {
  it("builds a 6-week month grid starting on a Sunday", () => {
    const cells = getMonthGrid(new Date(2026, 8, 1));
    expect(cells.length).toBe(42);
    expect(cells[0].date.getDay()).toBe(0);
    expect(cells[0].date.getMonth()).toBe(7);
    expect(cells[0].date.getDate()).toBe(30);
    expect(cells[41].date.getTime() - cells[0].date.getTime()).toBe(41 * 86_400_000);
  });

  it("formats a date key as YYYY-MM-DD", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("parses date-only and datetime strings as local dates", () => {
    expect(parseDueDate("2026-09-15")?.getDate()).toBe(15);
    expect(parseDueDate("2026-09-15T18:30:00")?.getHours()).toBe(18);
    expect(parseDueDate("")).toBeNull();
  });

  it("places a non-recurring note on its due date within the range", () => {
    const rangeStart = new Date(2026, 8, 1);
    const rangeEnd = new Date(2026, 8, 30, 23, 59, 59);
    const events = buildCalendarEvents([makeNote()], rangeStart, rangeEnd);
    expect(events).toHaveLength(1);
    expect(dateKey(events[0].date)).toBe("2026-09-15");
  });

  it("skips a non-recurring note outside the range", () => {
    const rangeStart = new Date(2026, 9, 1);
    const rangeEnd = new Date(2026, 9, 31, 23, 59, 59);
    const events = buildCalendarEvents([makeNote()], rangeStart, rangeEnd);
    expect(events).toHaveLength(0);
  });

  it("expands daily recurrence across the visible range", () => {
    const note = makeNote({ due_date: "2026-09-10T09:00:00", recurrence: "daily" });
    const dates = expandOccurrences(note, new Date(2026, 8, 1), new Date(2026, 8, 15, 23, 59, 59));
    expect(dates.map((d) => dateKey(d))).toEqual([
      "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15",
    ]);
  });

  it("stops recurrence expansion at the recurrence end", () => {
    const note = makeNote({
      due_date: "2026-09-10T09:00:00",
      recurrence: "daily",
      recurrence_end: "2026-09-12T23:59:59",
    });
    const dates = expandOccurrences(note, new Date(2026, 8, 1), new Date(2026, 9, 1));
    expect(dates.map((d) => dateKey(d))).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
  });

  it("builds an ICS feed with escaped summary and recurrence rule", () => {
    const note = makeNote({ title: "Check, restock", recurrence: "weekly" });
    const ics = buildIcsEvents([note]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Check\\, restock");
    expect(ics).toContain("DTSTART:20260915T090000");
    expect(ics).toContain("DTEND:20260915T100000");
    expect(ics).toContain("RRULE:FREQ=WEEKLY");
  });

  it("builds a Google Calendar add-event URL", () => {
    const url = googleCalUrl(makeNote({ title: "Restock & audit" }))!;
    expect(url).toContain("calendar.google.com/calendar/render?action=TEMPLATE");
    expect(url).toContain("Restock+%26+audit");
    expect(url).toContain("dates=20260915T090000/20260915T100000");
  });

  it("builds an Outlook.com add-event URL", () => {
    const url = outlookCalUrl(makeNote())!;
    expect(url).toContain("outlook.live.com/calendar/0/deeplink/compose");
    expect(url).toContain("startdt=2026-09-15T09%3A00%3A00");
    expect(url).toContain("enddt=2026-09-15T10%3A00%3A00");
  });
});