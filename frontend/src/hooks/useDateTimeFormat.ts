import { useSettings } from "./useSettings";
import { formatDateTime as applyFormat } from "../utils/date";

export function useDateTimeFormat() {
  const { data: settings } = useSettings();
  return (value?: Date | string | null, fallback?: string) => applyFormat(value, settings?.date_format, fallback);
}
