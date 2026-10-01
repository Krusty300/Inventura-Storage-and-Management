import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Repeat, Download, CalendarDays, CheckCircle2, ExternalLink } from "lucide-react";
import type { Note } from "../types";
import {
  buildCalendarEvents,
  dateKey,
  getMonthGrid,
  MONTHS,
  WEEKDAYS,
} from "../utils/calendar";

interface Props {
  notes: Note[];
  month: Date;
  loading?: boolean;
  onMonthChange: (value: Date) => void;
  onOpenNote: (note: Note) => void;
  onReschedule: (note: Note, dueDate: string) => void;
  onExport: () => void;
}

const CHIP_STYLES: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  normal: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};

interface HoverCard {
  note: Note;
  left: number;
  top: number;
}

const HOVER_CARD_WIDTH = 288;
const HOVER_CARD_HEIGHT = 320;

export default function TaskCalendar({
  notes,
  month,
  loading,
  onMonthChange,
  onOpenNote,
  onReschedule,
  onExport,
}: Props) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverCard | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [hover]);

  useEffect(
    () => () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const showHoverCard = (e: React.MouseEvent, note: Note) => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, vw - HOVER_CARD_WIDTH - 8));
    const roomBelow = rect.bottom + 8 + HOVER_CARD_HEIGHT <= vh - 8;
    setHover({
      note,
      left,
      top: roomBelow ? rect.bottom + 8 : Math.max(8, rect.top - HOVER_CARD_HEIGHT - 8),
    });
  };

  const hideHoverCard = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHover(null);
  };

  const scheduleHideHoverCard = () => {
    if (hover == null) return;
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(hideHoverCard, 150);
  };

  const cancelHideHoverCard = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);

  const events = buildCalendarEvents(notes, gridStart, gridEnd);
  const byDay = new Map<string, Note[]>();
  for (const ev of events) {
    const key = dateKey(ev.date);
    const list = byDay.get(key);
    if (list) list.push(ev.note);
    else byDay.set(key, [ev.note]);
  }

  const todayKey = dateKey(new Date());
  const cells = getMonthGrid(month);

  const handleDragStart = (e: React.DragEvent, note: Note) => {
    setDragId(note.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(note.id));
    }
  };

  const handleDrop = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    let id: number | null = dragId;
    if (id == null && e.dataTransfer) {
      const raw = e.dataTransfer.getData("text/plain");
      if (raw) id = Number(raw);
    }
    setDragId(null);
    if (id == null) return;
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    const time = note.due_date && note.due_date.length >= 16 ? note.due_date.slice(11, 16) : "09:00";
    onReschedule(note, `${dayKey}T${time}`);
  };

  return (
    <div className="p-4" aria-label="Task calendar">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-1">
          <button onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" title="Previous month" className="p-1.5 rounded text-muted hover:text-ink hover:bg-subtle transition-colors">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-2.5 py-1.5 rounded-lg text-sm font-medium text-muted hover:text-ink hover:bg-subtle transition-colors">
            Today
          </button>
          <button onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" title="Next month" className="p-1.5 rounded text-muted hover:text-ink hover:bg-subtle transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
        <h3 className="text-base font-semibold text-ink">{MONTHS[month.getMonth()]} {month.getFullYear()}</h3>
        <button onClick={onExport} className="btn-secondary text-sm" aria-label="Export visible notes to ICS">
          <Download size={14} className="inline mr-1" />
          Export .ics
        </button>
      </div>

      <div className="border border-border rounded-xl overflow-x-auto sa-viewport-contain">
        <div className="grid grid-cols-7 min-w-[640px] border-b border-border bg-app">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-muted uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>
        {loading ? (
          <div className="grid grid-cols-7 min-w-[640px]" aria-hidden="true">
            {Array.from({ length: 42 }).map((_, i) => (
              <div key={i} className="h-24 bg-subtle/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 min-w-[640px]">
            {cells.map(({ date, inMonth }) => {
              const key = dateKey(date);
              const dayNotes = byDay.get(key) || [];
              const isToday = key === todayKey;
              const hidden = dayNotes.length > 3;
              return (
                <div
                  key={key}
                  data-date={key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => handleDrop(e, key)}
                  className={`min-h-[96px] p-1.5 border-b border-r border-border flex flex-col gap-0.5 relative ${inMonth ? "bg-surface group/day" : "bg-subtle/40"} ${isToday ? "ring-1 ring-inset ring-primary/40" : ""}`}
                >
                  <span
                    className={`self-end text-xs font-medium mb-0.5 rounded-full px-1.5 ${isToday ? "bg-primary text-white" : inMonth ? "text-muted" : "text-faint"}`}
                  >
                    {date.getDate()}
                  </span>
                  <div className="space-y-0.5 min-h-[56px]">
                    {dayNotes.slice(0, 3).map((note) => (
                      <div
                        key={note.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, note)}
                        onClick={() => onOpenNote(note)}
                        onMouseEnter={(e) => showHoverCard(e, note)}
                        onMouseLeave={scheduleHideHoverCard}
                        title={note.title}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium cursor-pointer select-none truncate transition-opacity ${CHIP_STYLES[note.priority] || CHIP_STYLES.normal} ${dragId === note.id ? "opacity-40" : ""} ${note.is_completed ? "line-through opacity-60" : ""}`}
                      >
                        {note.recurrence !== "none" && <Repeat size={10} className="shrink-0" />}
                        <span className="truncate">{note.title}</span>
                      </div>
                    ))}
                    {hidden && (
                      <div className="text-[10px] text-muted px-1">+{dayNotes.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hover &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={cancelHideHoverCard}
            onMouseLeave={hideHoverCard}
            style={{
              position: "fixed",
              left: hover.left,
              top: hover.top,
              width: HOVER_CARD_WIDTH,
            }}
            className="z-50 rounded-xl border border-border-strong bg-surface shadow-xl p-3 text-sm"
          >
            {hover.note.image_url && (
              <div className="-mx-3 -mt-3 mb-3 overflow-hidden rounded-t-xl">
                <img src={hover.note.image_url} alt="" className="w-full h-28 object-cover" loading="lazy" draggable={false} />
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP_STYLES[hover.note.priority] || CHIP_STYLES.normal}`}>
                {hover.note.recurrence !== "none" && <Repeat size={10} />}
                <span className="capitalize">{hover.note.priority}</span>
              </span>
              {hover.note.is_completed && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                  <CheckCircle2 size={12} />
                  Completed
                </span>
              )}
            </div>
            <p className="mt-2 font-semibold text-ink leading-snug break-words">{hover.note.title}</p>
            {hover.note.body && <p className="mt-1 text-xs text-muted line-clamp-2 break-words">{hover.note.body}</p>}
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays size={12} className="text-faint shrink-0" />
              <span>
                {hover.note.due_date
                  ? new Date(hover.note.due_date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                  : "No due date"}
              </span>
            </div>
            {hover.note.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {hover.note.tags.map((t) => (
                  <span key={t.id} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${t.color}26`, color: t.color }}>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 pt-2.5 border-t border-border flex justify-end">
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1.5 text-xs px-3 py-1.5"
                onClick={() => {
                  hideHoverCard();
                  onOpenNote(hover.note);
                }}
              >
                View note
                <ExternalLink size={12} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}