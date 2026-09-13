export function parseLocalDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export function formatDate(value?: Date | string | null, format?: string, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return fallback;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  switch (format) {
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    case "DD-MM-YYYY":
      return `${day}-${month}-${year}`;
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "DD.MM.YYYY":
      return `${day}.${month}.${year}`;
    case "MM-DD-YYYY":
      return `${month}-${day}-${year}`;
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    default:
      return d.toLocaleDateString();
  }
}

export function daysUntil(date: Date | string): number {
  const d = typeof date === "string" ? parseLocalDate(date) : date;
  const now = new Date();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function daysAgo(date: Date | string): number {
  const d = typeof date === "string" ? parseLocalDate(date) : date;
  const now = new Date();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today.getTime() - target.getTime()) / 86_400_000);
}

export type OverdueStatus = "overdue" | "due" | null;

/** Classifies an expected date: "overdue" once its day has passed, "due" within
 * the next 3 days (inclusive of today), otherwise null. Date-boundary only, to
 * match the ASN/Notes overdue behaviour regardless of time-of-day. */
export function overdueStatus(value: Date | string | null | undefined): OverdueStatus {
  if (value === null || value === undefined || value === "") return null;
  const days = daysUntil(value);
  if (days < 0) return "overdue";
  if (days <= 3) return "due";
  return null;
}

export function formatDateTime(value?: Date | string | null, format?: string, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return fallback;
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(d, format, fallback)} ${hours}:${minutes}`;
}

