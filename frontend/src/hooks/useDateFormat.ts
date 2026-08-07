import { useSettings } from "./useSettings";
import { formatDate as applyFormat } from "../utils/date";

export function useDateFormat() {
  const { data: settings } = useSettings();
  return (value?: Date | string | null, fallback?: string) => applyFormat(value, settings?.date_format, fallback);
}
