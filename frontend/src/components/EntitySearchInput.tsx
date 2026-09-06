import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import api from "../api/client";
import { useDebounce } from "../hooks/useDebounce";
import { getLinkableEntity } from "../utils/linkableEntities";

interface Props {
  entityType: string;
  onSelect: (selection: { entity_type: string; entity_id: number; entity_label: string }) => void;
  excludeIds?: { entity_type: string; entity_id: number }[];
  placeholder?: string;
  disabled?: boolean;
}

export default function EntitySearchInput({ entityType, onSelect, excludeIds = [], placeholder, disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounced = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const config = getLinkableEntity(entityType);
  const searchType = config?.searchType ?? entityType;

  const { data, isFetching } = useQuery({
    queryKey: ["entity-search", searchType, debounced],
    queryFn: async () => {
      const { data } = await api.get("/search", { params: { q: debounced, per_type: 10 } });
      return (data.results ?? []) as { type: string; id: number; label: string; subtitle: string }[];
    },
    enabled: debounced.trim().length >= 2,
  });

  const results = (data ?? []).filter(
    (r) => r.type === searchType && !excludeIds.some((e) => e.entity_type === entityType && e.entity_id === r.id),
  );

  useEffect(() => {
    setActiveIdx(-1);
  }, [results]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node) && inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (r: { type: string; id: number; label: string }) => {
    onSelect({ entity_type: entityType, entity_id: r.id, entity_label: r.label });
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      select(results[activeIdx]);
    }
  };

  const label = config?.label ?? entityType.replace(/_/g, " ");

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          ref={inputRef}
          className="input pl-8 pr-8 text-sm w-full"
          placeholder={placeholder ?? `Search ${label.toLowerCase()}s...`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label={`Search ${label}`}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-autocomplete="list"
        />
        {isFetching && (
          <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-faint" />
        )}
      </div>
      {open && results.length > 0 && (
        <div ref={listRef} className="absolute left-0 right-0 top-full mt-1 z-50 card p-0 overflow-hidden max-h-48 overflow-y-auto shadow-lg" role="listbox">
          {results.map((r, idx) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              onClick={() => select(r)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${idx === activeIdx ? "bg-primary-soft dark:bg-primary/10" : "hover:bg-app"}`}
              role="option"
              aria-selected={idx === activeIdx}
            >
              <span className="min-w-0">
                <span className="block font-medium text-ink truncate">{r.label}</span>
                {r.subtitle && <span className="block text-xs text-muted truncate">{r.subtitle}</span>}
              </span>
              <span className="shrink-0 text-xs text-faint ml-2">#{r.id}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && !isFetching && results.length === 0 && (
        <div ref={listRef} className="absolute left-0 right-0 top-full mt-1 z-50 card p-3 text-sm text-muted text-center shadow-lg">
          No {label.toLowerCase()}s found
        </div>
      )}
    </div>
  );
}
