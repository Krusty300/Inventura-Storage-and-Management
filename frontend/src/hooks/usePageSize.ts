import { useState } from "react";
import { useSettings } from "./useSettings";

export function usePageSize() {
  const { data: settings } = useSettings();
  const [override, setOverride] = useState<number | null>(null);
  const pageSize = override ?? settings?.default_items_per_page ?? 25;
  const setPageSize = (n: number) => setOverride(n);
  return { pageSize, setPageSize };
}
