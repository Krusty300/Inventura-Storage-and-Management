import { useState } from "react";

export function useBulkSelection<T extends { id: number }>(rows: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((r) => r.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  return { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection };
}
