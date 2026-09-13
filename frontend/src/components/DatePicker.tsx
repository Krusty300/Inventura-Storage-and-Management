import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Note } from "../types";
import {
  buildCalendarEvents,
  dateKey,
  getMonthGrid,
  MONTHS,
  pad2,
  splitDateTime,
  toDateTimeInput,
  WEEKDAYS,
} from "../utils/calendar";
import { useDateFormat } from "../hooks/useDateFormat";

const GAP = 4;
const VIEWPORT_MARGIN = 8;

interface PopupPos {
  left: number;
  minWidth: number;
  top?: number;
  bottom?: number;
}

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** "date" emits "YYYY-MM-DD"; "datetime" emits "YYYY-MM-DDTHH:MM". */
  mode?: "date" | "datetime";
  placeholder?: string;
  ariaLabel?: string;
  /** Extra classes for the wrapper (e.g. "flex-1 min-w-0"). */
  className?: string;
  /** Extra classes for the trigger input (e.g. "text-sm py-1.5"). */
  inputClassName?: string;
  disabled?: boolean;
  /** Earliest selectable day as "YYYY-MM-DD". */
  min?: string;
  /** Latest selectable day as "YYYY-MM-DD". */
  max?: string;
  /** Notes shown as dots on days with due occurrences. */
  notes?: Note[];
  /** Close after picking a day. Defaults to true for "date" mode. */
  autoClose?: boolean;
}

export default function DatePicker({
  value,
  onChange,
  mode = "date",
  placeholder,
  ariaLabel,
  className,
  inputClassName,
  disabled = false,
  min,
  max,
  notes,
  autoClose,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [focusIdx, setFocusIdx] = useState(0);
  const [pos, setPos] = useState<PopupPos>({ left: 0, minWidth: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const calendarId = useId();

  const dateFmt = useDateFormat();
  const isDateTime = mode === "datetime";
  const closeOnDaySelect = autoClose ?? !isDateTime;

  const parsed = splitDateTime(value);
  const selectedKey = parsed ? dateKey(parsed.date) : "";
  const todayKey = dateKey(new Date());
  const cells = getMonthGrid(viewMonth);

  const notesByDay = useMemo(() => {
    if (!notes || notes.length === 0) return new Map<string, number>();
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const end = new Date(first);
    end.setDate(start.getDate() + 41);
    const map = new Map<string, number>();
    for (const ev of buildCalendarEvents(notes, start, end)) {
      const k = dateKey(ev.date);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [notes, viewMonth]);

  const openPicker = () => {
    if (disabled) return;
    const base = parsed?.date ?? new Date();
    const target = new Date(base.getFullYear(), base.getMonth(), 1);
    setViewMonth(target);
    const grid = getMonthGrid(target);
    const want = parsed ? dateKey(parsed.date) : todayKey;
    const idx = grid.findIndex((c) => dateKey(c.date) === want);
    setFocusIdx(Math.max(0, idx));
    setOpen(true);
  };

  const closePicker = () => {
    setOpen(false);
    cellRefs.current = [];
  };

  const positionMenu = useCallback(() => {
    const wrapper = wrapperRef.current;
    const menu = menuRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(288, rect.width), vw - VIEWPORT_MARGIN * 2);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, vw - VIEWPORT_MARGIN - width));
    const menuH = menu ? menu.offsetHeight : 340;
    const roomBelow = rect.bottom + GAP + menuH <= vh - VIEWPORT_MARGIN;
    const roomAbove = rect.top - GAP - menuH >= VIEWPORT_MARGIN;
    const up = !roomBelow && roomAbove;
    setPos({
      left,
      minWidth: width,
      top: up ? undefined : rect.bottom + GAP,
      bottom: up ? vh - rect.top + GAP : undefined,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    const retry = window.setTimeout(positionMenu, 0);
    window.addEventListener("resize", positionMenu);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closePicker();
    };
    const onDocScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closePicker();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("scroll", onDocScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("scroll", onDocScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) cellRefs.current[focusIdx]?.focus();
  }, [open, focusIdx]);

  const isDisabledDay = (key: string): boolean =>
    Boolean(
      (min && key.length === min.length && key < min) || (max && key.length === max.length && key > max),
    );

  const selectDay = (d: Date) => {
    const key = dateKey(d);
    if (isDisabledDay(key)) return;
    if (isDateTime) {
      const hour = parsed ? parsed.hour : 9;
      const minute = parsed ? parsed.minute : 0;
      onChange(toDateTimeInput(d, hour, minute));
    } else {
      onChange(key);
    }
    if (closeOnDaySelect) closePicker();
  };

  const pickToday = () => {
    const t = new Date();
    if (isDateTime) onChange(toDateTimeInput(t, t.getHours(), t.getMinutes()));
    else onChange(dateKey(t));
    if (closeOnDaySelect) closePicker();
  };

  const clearValue = () => {
    onChange("");
    closePicker();
  };

  const setHour = (hour: number) => {
    const d = parsed?.date ?? new Date();
    onChange(toDateTimeInput(d, hour, parsed?.minute ?? 0));
  };

  const setMinute = (minute: number) => {
    const d = parsed?.date ?? new Date();
    onChange(toDateTimeInput(d, parsed?.hour ?? 9, minute));
  };

  const shiftMonth = (delta: number) => setViewMonth((vm) => new Date(vm.getFullYear(), vm.getMonth() + delta, 1));

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    } else if (e.key === "Tab") {
      closePicker();
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    const last = cells.length - 1;
    let next = focusIdx;
    switch (e.key) {
      case "ArrowUp":
        next = Math.max(0, focusIdx - 7);
        e.preventDefault();
        break;
      case "ArrowDown":
        next = Math.min(last, focusIdx + 7);
        e.preventDefault();
        break;
      case "ArrowLeft":
        next = Math.max(0, focusIdx - 1);
        e.preventDefault();
        break;
      case "ArrowRight":
        next = Math.min(last, focusIdx + 1);
        e.preventDefault();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (cells[focusIdx]) selectDay(cells[focusIdx].date);
        break;
      case "Escape":
        e.preventDefault();
        closePicker();
        break;
      default:
        return;
    }
    if (next !== focusIdx) setFocusIdx(next);
  };

  const display = parsed
    ? isDateTime
      ? `${dateFmt(parsed.date)} ${pad2(parsed.hour)}:${pad2(parsed.minute)}`
      : dateFmt(parsed.date)
    : "";

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        <input
          type="text"
          readOnly
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-controls={open ? calendarId : undefined}
          className={`input pr-9 cursor-pointer ${inputClassName ?? ""}`}
          value={display}
          placeholder={placeholder ?? (isDateTime ? "Select date & time" : "Select a date")}
          disabled={disabled}
          onClick={openPicker}
          onKeyDown={handleTriggerKeyDown}
        />
        <CalendarDays
          size={16}
          className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-faint transition-colors ${open ? "text-primary" : ""}`}
        />
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={ariaLabel ? `${ariaLabel} picker` : "Date picker"}
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth }}
            className="z-50 rounded-lg border border-border-strong bg-surface shadow-lg p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="p-1 rounded text-muted hover:text-ink hover:bg-subtle transition-colors">
                <ChevronLeft size={16} />
              </button>
              <div className="text-sm font-semibold text-ink" aria-live="polite">
                {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </div>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="p-1 rounded text-muted hover:text-ink hover:bg-subtle transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-muted uppercase tracking-wider py-1">
                  {d}
                </div>
              ))}
            </div>

            <div id={calendarId} role="grid" aria-label="Calendar grid" onKeyDown={handleGridKeyDown} className="grid grid-cols-7 gap-0.5">
              {cells.map(({ date, inMonth }, i) => {
                const key = dateKey(date);
                const isSelected = selectedKey !== "" && key === selectedKey;
                const isToday = key === todayKey;
                const outOfRange = isDisabledDay(key);
                const dotCount = notesByDay.get(key) ?? 0;
                return (
                  <button
                    key={key}
                    type="button"
                    ref={(el) => {
                      cellRefs.current[i] = el;
                    }}
                    onClick={() => selectDay(date)}
                    disabled={outOfRange}
                    aria-label={`${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`}
                    aria-selected={isSelected}
                    tabIndex={open && i === focusIdx ? 0 : -1}
                    className={`relative flex h-8 flex-col items-center justify-center rounded-md text-xs transition-colors ${
                      isSelected
                        ? "bg-primary-solid text-white font-semibold"
                        : isToday
                          ? "text-primary-strong dark:text-primary font-semibold ring-1 ring-inset ring-primary"
                          : inMonth
                            ? "text-ink hover:bg-subtle"
                            : "text-faint hover:bg-subtle"
                    } ${outOfRange ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span>{date.getDate()}</span>
                    {dotCount > 0 && (
                      <span className="mt-0.5 flex h-1 gap-0.5" aria-hidden="true">
                        {Array.from({ length: Math.min(dotCount, 3) }).map((_, d) => (
                          <span key={d} data-testid="note-dot" className={`h-1 w-1 rounded-full ${isSelected ? "bg-white/80" : "bg-primary"}`} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {isDateTime && (
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                <span className="text-xs text-muted shrink-0">Time</span>
                <select className="select input py-1 text-sm" value={parsed ? parsed.hour : 0} onChange={(e) => setHour(Number(e.target.value))} aria-label="Hour">
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {pad2(h)}
                    </option>
                  ))}
                </select>
                <span className="text-faint text-sm" aria-hidden="true">:</span>
                <select className="select input py-1 text-sm" value={parsed ? parsed.minute : 0} onChange={(e) => setMinute(Number(e.target.value))} aria-label="Minute">
                  {Array.from({ length: 60 }).map((_, m) => (
                    <option key={m} value={m}>
                      {pad2(m)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={pickToday} className="px-1.5 py-1 rounded-md text-xs font-medium text-primary dark:text-primary hover:text-primary-strong">
                  Today
                </button>
                <button type="button" onClick={clearValue} className="px-1.5 py-1 rounded-md text-xs font-medium text-muted hover:text-ink">
                  Clear
                </button>
              </div>
              {isDateTime && (
                <button type="button" onClick={closePicker} className="px-1.5 py-1 rounded-md text-xs font-medium text-primary dark:text-primary hover:text-primary-strong">
                  Done
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}