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
    case "MM-DD-YYYY":
      return `${month}-${day}-${year}`;
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    default:
      return d.toLocaleDateString();
  }
}

export function formatDateTime(value?: Date | string | null, format?: string, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return fallback;
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(d, format, fallback)} ${hours}:${minutes}`;
}

