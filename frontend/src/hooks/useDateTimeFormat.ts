import { useSettings } from "./useSettings";
import { formatDateTime as applyFormat } from "../utils/date";

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

export function useDateTimeFormat() {
  const { data: settings } = useSettings();
  return (value?: Date | string | null, fallback?: string) => applyFormat(value, settings?.date_format ?? DEFAULT_DATE_FORMAT, fallback);
}