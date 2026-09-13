import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { parseLocalDate } from "../utils/date";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  value: string | Date;
  label?: string;
}

export default function DateTimeHoverCard({ value, label }: Props) {
  const { resolvedTheme } = useTheme();
  const parsed = useMemo(() => (typeof value === "string" ? parseLocalDate(value.replace(" ", "T")) : new Date(value)), [value]);
  const [mode, setMode] = useState<"light" | "dark">(resolvedTheme);
  const isDark = mode === "dark";

  if (Number.isNaN(parsed.getTime())) {
    return <span className="text-muted text-sm">—</span>;
  }

  const year = parsed.getFullYear();
  const month = parsed.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const now = new Date();
  const isToday = (m: number, d: number) => now.getFullYear() === year && now.getMonth() === m && now.getDate() === d;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 42; i++) {
    const dayIndex = i - firstDow + 1;
    let dayNum: number;
    let monthOffset: number;
    if (dayIndex < 1) {
      dayNum = daysInPrev - firstDow + i + 1;
      monthOffset = -1;
    } else if (dayIndex > daysInMonth) {
      dayNum = dayIndex - daysInMonth;
      monthOffset = 1;
    } else {
      dayNum = dayIndex;
      monthOffset = 0;
    }
    const selected = monthOffset === 0 && dayNum === parsed.getDate();
    const today = monthOffset === 0 && isToday(month, dayNum);
    const cls = [
      "flex h-7 w-7 items-center justify-center rounded-full text-xs",
      monthOffset !== 0 ? "text-slate-300 dark:text-slate-600" : "text-slate-600 dark:text-slate-300",
      today ? "border border-primary/60 font-semibold text-primary dark:text-primary" : "",
      selected ? "bg-primary-solid text-white dark:text-white font-bold shadow-md ring-2 ring-primary/40 dark:ring-primary/60" : "",
    ]
      .filter(Boolean)
      .join(" ");
    cells.push(
      <span
        key={i}
        role="gridcell"
        aria-label={`${DAY_LABELS[new Date(year, month + monthOffset, dayNum).getDay()]} ${MONTHS[month + monthOffset]} ${dayNum}, ${monthOffset === 0 ? year : new Date(year, month + monthOffset, 1).getFullYear()}`}
        aria-current={selected ? "date" : undefined}
        className={cls}
      >
        {dayNum}
      </span>,
    );
  }

  const longDate = `${DAY_LABELS[parsed.getDay()]}, ${MONTHS[month]} ${parsed.getDate()}, ${year}`;

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="animate-dt-pop w-full space-y-3 rounded-xl bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label || "Date & time"}</p>
            <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{longDate}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            aria-label="Toggle preview theme"
            onClick={() => setMode(isDark ? "light" : "dark")}
            className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${isDark ? "bg-slate-700" : "bg-slate-200"}`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] shadow transition-transform ${
                isDark ? "translate-x-5 bg-slate-900 text-amber-300" : "translate-x-0 bg-white text-amber-500"
              }`}
            >
              {isDark ? <Moon size={12} /> : <Sun size={12} />}
            </span>
          </button>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <span>{MONTHS[month]} {year}</span>
            <span>{parsed.getDate()}</span>
          </div>
          <div role="grid" aria-label="Mini calendar" className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                {w}
              </span>
            ))}
            {cells}
          </div>
        </div>
      </div>
    </div>
  );
}