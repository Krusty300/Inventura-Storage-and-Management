import type { Note } from "../types";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type CalendarEvent = {
  note: Note;
  date: Date;
};

const RECURRENCE_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export interface ParsedDateTime {
  date: Date;
  hasTime: boolean;
  hour: number;
  minute: number;
}

/**
 * Parses the ISO-ish values used by date/datetime fields across the app:
 * "YYYY-MM-DD", "YYYY-MM-DDTHH:MM", "YYYY-MM-DDTHH:MM:SS", with an optional
 * trailing timezone ("Z" or "+HH:MM") or "".
 *
 * Naive values are interpreted as local wall-clock components. Values carrying
 * an explicit offset are converted to the local wall-clock so the picker edits
 * what the user actually sees elsewhere in the app.
 */
export function splitDateTime(value: string): ParsedDateTime | null {
  const raw = value || "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const hour = m[4] !== undefined ? Math.min(23, Math.max(0, Number(m[4]))) : 0;
  const minute = m[5] !== undefined ? Math.min(59, Math.max(0, Number(m[5]))) : 0;
  if (m[4] !== undefined && /(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const inst = new Date(raw);
    if (Number.isNaN(inst.getTime())) return null;
    return {
      date: new Date(inst.getFullYear(), inst.getMonth(), inst.getDate()),
      hasTime: true,
      hour: inst.getHours(),
      minute: inst.getMinutes(),
    };
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return {
    date,
    hasTime: m[4] !== undefined,
    hour,
    minute,
  };
}

/**
 * Builds the compact value emitted by datetime fields:
 * "YYYY-MM-DDTHH:MM" plus the runtime UTC offset ("+HH:MM") so a naive
 * backend that stores values as UTC preserves the chosen local wall-clock
 * as the same instant.
 */
export function toDateTimeInput(date: Date, hour?: number, minute?: number): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour ?? 0, minute ?? 0, 0, 0);
  const offMin = -local.getTimezoneOffset();
  const sign = offMin < 0 ? "-" : "+";
  const abs = Math.abs(offMin);
  return `${dateKey(local)}T${pad2(hour ?? 0)}:${pad2(minute ?? 0)}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

export function parseDueDate(value: string | null): Date | null {
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function earliestDate(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

export function latestDate(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

export function getMonthGrid(month: Date): { date: Date; inMonth: boolean }[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month.getMonth() });
  }
  return cells;
}

/**
 * Expands a recurring note into its occurrence dates that fall within the
 * given range. Matches the backend's rolling recurrence (daily/weekly/30-day
 * monthly steps from the current due date).
 */
export function expandOccurrences(note: Note, rangeStart: Date, rangeEnd: Date): Date[] {
  if (!note.due_date || note.recurrence === "none") return [];
  const start = parseDueDate(note.due_date);
  if (!start) return [];
  const step = RECURRENCE_DAYS[note.recurrence];
  if (!step) return [];
  const rawEnd = note.recurrence_end ? parseDueDate(note.recurrence_end) : null;
  const end = earliestDate([rawEnd, rangeEnd]);
  if (!end) return [];
  const out: Date[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let safety = 0;
  while (cur.getTime() <= end.getTime() && safety < 2000) {
    if (cur.getTime() >= rangeStart.getTime()) out.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + step);
    safety += 1;
  }
  return out;
}

export function buildCalendarEvents(notes: Note[], rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const note of notes) {
    if (note.recurrence !== "none") {
      for (const d of expandOccurrences(note, rangeStart, rangeEnd)) events.push({ note, date: d });
    } else if (note.due_date) {
      const d = parseDueDate(note.due_date);
      if (d && d.getTime() >= rangeStart.getTime() && d.getTime() <= rangeEnd.getTime()) {
        events.push({ note, date: d });
      }
    }
  }
  return events;
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function toLocalStamp(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function toUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function rrule(note: Note): string | null {
  const freq: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };
  const f = freq[note.recurrence];
  if (!f) return null;
  if (!note.recurrence_end) return `RRULE:FREQ=${f}`;
  const end = parseDueDate(note.recurrence_end);
  if (!end) return `RRULE:FREQ=${f}`;
  return `RRULE:FREQ=${f};UNTIL=${toUtcStamp(end)}`;
}

export function buildIcsEvents(notes: Note[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Inventura//Task Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const note of notes) {
    const dt = parseDueDate(note.due_date);
    if (!dt) continue;
    const start = new Date(dt);
    const end = new Date(start);
    end.setTime(end.getTime() + 60 * 60 * 1000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:note-${note.id}@inventura`);
    lines.push(`DTSTAMP:${toUtcStamp(new Date())}`);
    lines.push(`DTSTART:${toLocalStamp(start)}`);
    lines.push(`DTEND:${toLocalStamp(end)}`);
    lines.push(`SUMMARY:${escapeIcs(note.title)}`);
    if (note.body) lines.push(`DESCRIPTION:${escapeIcs(note.body)}`);
    const rule = rrule(note);
    if (rule) lines.push(rule);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function toDashedLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function googleCalUrl(note: Note): string | null {
  const dt = parseDueDate(note.due_date);
  if (!dt) return null;
  const end = new Date(dt.getTime() + 60 * 60 * 1000);
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  const parts = [
    "action=TEMPLATE",
    `text=${enc(note.title)}`,
    `dates=${toLocalStamp(dt)}/${toLocalStamp(end)}`,
  ];
  if (note.body) parts.push(`details=${enc(note.body)}`);
  return `https://calendar.google.com/calendar/render?${parts.join("&")}`;
}

export function outlookCalUrl(note: Note): string | null {
  const dt = parseDueDate(note.due_date);
  if (!dt) return null;
  const end = new Date(dt.getTime() + 60 * 60 * 1000);
  const params = new URLSearchParams({
    subject: note.title,
    startdt: toDashedLocal(dt),
    enddt: toDashedLocal(end),
  });
  if (note.body) params.set("body", note.body);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function downloadIcs(filename: string, ics: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function safeFilename(title: string): string {
  return (title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-") || "task").replace(/(^-|-$)/g, "");
}