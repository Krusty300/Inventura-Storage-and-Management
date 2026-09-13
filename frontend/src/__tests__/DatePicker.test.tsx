import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";
import DatePicker, { type DatePickerProps } from "../components/DatePicker";
import { dateKey, splitDateTime, toDateTimeInput } from "../utils/calendar";
import type { Note } from "../types";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;

function todayKey(): string {
  return dateKey(new Date());
}

function tomorrowKey(): string {
  const t = new Date();
  return dateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 1,
    title: "Reminder",
    body: "",
    category: "reminder",
    priority: "normal",
    is_pinned: false,
    is_completed: false,
    is_archived: false,
    due_date: `${todayKey()}T09:00`,
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

type PickerProps = Omit<DatePickerProps, "value" | "onChange">;

function Harness({ initialValue, ...props }: { initialValue: string } & PickerProps) {
  const [value, setValue] = useState(initialValue);
  return <DatePicker value={value} onChange={setValue} {...props} />;
}

function renderPicker(props: Partial<PickerProps> & { initialValue?: string } = {}) {
  const { initialValue = "", ...rest } = props;
  return renderWithProviders(<Harness initialValue={initialValue} {...rest} />);
}

describe("DatePicker helpers", () => {
  it("splits date-only values", () => {
    const p = splitDateTime("2026-06-15");
    expect(p).not.toBeNull();
    expect(p?.hasTime).toBe(false);
    expect(dateKey(p!.date)).toBe("2026-06-15");
  });

  it("splits datetime values including seconds", () => {
    const p = splitDateTime("2026-06-15T14:35");
    expect(p?.hasTime).toBe(true);
    expect(p?.hour).toBe(14);
    expect(p?.minute).toBe(35);
    const s = splitDateTime("2026-06-15T09:00:00");
    expect(s?.hour).toBe(9);
    expect(s?.minute).toBe(0);
  });

  it("returns null for empty or invalid values", () => {
    expect(splitDateTime("")).toBeNull();
    expect(splitDateTime("garbage")).toBeNull();
    expect(splitDateTime("2026-13-01")).toBeNull();
  });

  it("builds datetime input values with the local UTC offset", () => {
    const local = new Date(2026, 5, 15, 9, 5);
    const offMin = -local.getTimezoneOffset();
    const sign = offMin < 0 ? "-" : "+";
    const abs = Math.abs(offMin);
    const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    expect(toDateTimeInput(new Date(2026, 5, 15), 9, 5)).toBe(`2026-06-15T09:05${off}`);
  });

  it("converts UTC-offset datetimes to the local wall-clock for editing", () => {
    const inst = "2026-06-15T14:05:00+00:00";
    const parsed = new Date(inst);
    const p = splitDateTime(inst);
    expect(p).not.toBeNull();
    expect(p!.hasTime).toBe(true);
    expect(p!.hour).toBe(parsed.getHours());
    expect(p!.minute).toBe(parsed.getMinutes());
    expect(dateKey(p!.date)).toBe(dateKey(parsed));
  });

  it("re-emits the same instant for values carrying an offset", () => {
    const value = "2026-06-15T14:05:00+00:00";
    const p = splitDateTime(value)!;
    const out = toDateTimeInput(p.date, p.hour, p.minute);
    expect(new Date(out).getTime()).toBe(new Date(value).getTime());
  });
});

describe("DatePicker date mode", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({ data: { date_format: "YYYY-MM-DD" } });
  });

  it("opens the popover and selects the focused day via keyboard", () => {
    renderPicker({ ariaLabel: "Due date" });

    const trigger = screen.getByRole("combobox", { name: "Due date" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });

    expect(trigger).toHaveValue(tomorrowKey());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the popover on Escape", () => {
    renderPicker({ ariaLabel: "Due date" });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selects today via the Today button", () => {
    renderPicker({ ariaLabel: "Due date" });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("combobox", { name: "Due date" })).toHaveValue(todayKey());
  });

  it("clears the value via the Clear button", () => {
    renderPicker({ ariaLabel: "Due date", initialValue: "2026-06-15" });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("combobox", { name: "Due date" })).toHaveValue("");
  });

  it("respects the user date format from settings for display", async () => {
    getMock.mockResolvedValue({ data: { date_format: "DD/MM/YYYY" } });
    renderPicker({ ariaLabel: "Due date", initialValue: "2026-06-15" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Due date" })).toHaveValue("15/06/2026"),
    );
  });

  it("disables days outside the min/max range", () => {
    renderPicker({ ariaLabel: "Due date", min: tomorrowKey(), max: tomorrowKey() });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));

    const t = new Date();
    const todayLabel = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}`;
    const todayCell = screen.getByRole("button", { name: todayLabel });
    expect(todayCell).toBeDisabled();
  });

  it("shows dots for days that have notes due", () => {
    renderPicker({ ariaLabel: "Due date", notes: [makeNote()] });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));

    const t = new Date();
    const todayLabel = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}`;
    expect(within(screen.getByRole("button", { name: todayLabel })).getByTestId("note-dot")).toBeInTheDocument();
  });
});

describe("DatePicker datetime mode", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({ data: { date_format: "YYYY-MM-DD" } });
  });

  it("picks a day and keeps the popover open to adjust time", () => {
    renderPicker({ ariaLabel: "Due date", mode: "datetime" });
    const trigger = screen.getByRole("combobox", { name: "Due date" });
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });

    expect(trigger).toHaveValue(`${tomorrowKey()} 09:00`);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("updates the time through the hour/minute selects", () => {
    renderPicker({ ariaLabel: "Due date", mode: "datetime", initialValue: "2026-06-15T09:30" });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));

    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Minute"), { target: { value: "5" } });

    expect(screen.getByRole("combobox", { name: "Due date" })).toHaveValue("2026-06-15 14:05");
  });

  it("closes via the Done button in datetime mode", () => {
    renderPicker({ ariaLabel: "Due date", mode: "datetime" });
    fireEvent.click(screen.getByRole("combobox", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("displays date and time in the trigger", () => {
    renderPicker({ ariaLabel: "Due date", mode: "datetime", initialValue: "2026-06-15T14:05" });
    expect(screen.getByRole("combobox", { name: "Due date" })).toHaveValue("2026-06-15 14:05");
  });
});