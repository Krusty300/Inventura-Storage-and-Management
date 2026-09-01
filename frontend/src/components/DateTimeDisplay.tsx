import { useEffect, useState } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import { formatDate } from "../utils/date";

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

export default function DateTimeDisplay() {
  const { data: settings } = useSettings();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return (
    <div
      className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-lg border border-border bg-subtle text-xs text-muted"
      aria-label={`Current date and time`}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap" title="Current date">
        <CalendarDays size={14} className="text-faint" />
        {formatDate(now, settings?.date_format ?? DEFAULT_DATE_FORMAT)}
      </span>
      <span className="h-4 w-px bg-border" aria-hidden="true" />
      <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums" title="Current time">
        <Clock size={14} className="text-faint" />
        {hours}:{minutes}:{seconds}
      </span>
    </div>
  );
}
