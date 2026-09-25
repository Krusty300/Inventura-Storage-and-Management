import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import api from "../api/client";
import type { Customer } from "../types";
import { useDebounce } from "../hooks/useDebounce";
import ScrollArea from "./ScrollArea";

interface Props {
  value: number | null;
  onChange: (id: number | null) => void;
  onSelectCustomer?: (customer: Customer) => void;
  disabled?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  placeholder?: string;
}

export default function CustomerPicker({
  value,
  onChange,
  onSelectCustomer,
  disabled,
  allowClear = true,
  clearLabel = "Walk-in (no customer)",
  placeholder = "Search by name or phone...",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounced = useDebounce(query.trim(), 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["customer-picker", debounced],
    queryFn: async () => {
      const { data } = await api.get("/customers", { params: { search: debounced, limit: 40, skip: 0 } });
      return (data.items ?? []) as Customer[];
    },
  });

  const results = (data ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const selected = results.find((c) => c.id === value) ?? null;

  const select = (id: number | null) => {
    onChange(id);
    if (id != null) {
      const customer = results.find((c) => c.id === id);
      if (customer) onSelectCustomer?.(customer);
    }
    setQuery("");
    setOpen(false);
    setActiveIdx(-1);
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
      setActiveIdx((i) => Math.min(i + 1, results.length - 1 + (allowClear && value !== null ? 1 : 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const clearRow = allowClear && value !== null;
      if (clearRow && activeIdx === 0) {
        select(null);
        return;
      }
      const customer = results[activeIdx - (clearRow ? 1 : 0)];
      if (customer) select(customer.id);
    }
  };

  const showClearRow = allowClear && value !== null;
  const listActiveIndex = (i: number) => (showClearRow ? i + 1 : i);

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          ref={inputRef}
          className="input pl-8 pr-9 text-sm w-full"
          placeholder={placeholder}
          value={selected ? `${selected.name}${selected.phone ? ` — ${selected.phone}` : ""}` : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => {
            if (selected) {
              setQuery("");
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="Customer"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {isFetching && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-faint" />}
        {!isFetching && selected && (
          <button
            type="button"
            aria-label="Clear customer"
            onClick={() => {
              setQuery("");
              onChange(null);
              inputRef.current?.focus();
              setOpen(true);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-faint hover:text-ink hover:bg-subtle transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && (results.length > 0 || showClearRow) && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full mt-1 z-50"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ScrollArea className="card p-0 overflow-hidden shadow-lg" role="listbox" viewportClassName="max-h-52 sa-viewport-contain">
            {showClearRow && (
              <button
                type="button"
                onClick={() => select(null)}
                onMouseEnter={() => setActiveIdx(0)}
                className={`w-full flex items-center px-3 py-2 text-left text-sm transition-colors ${activeIdx === 0 ? "bg-primary-soft dark:bg-primary/10" : "hover:bg-app"}`}
                role="option"
                aria-selected={activeIdx === 0}
              >
                <span className="text-muted">{clearLabel}</span>
              </button>
            )}
            {results.map((c, idx) => {
              const li = listActiveIndex(idx);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  onMouseEnter={() => setActiveIdx(li)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${li === activeIdx ? "bg-primary-soft dark:bg-primary/10" : "hover:bg-app"}`}
                  role="option"
                  aria-selected={li === activeIdx}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink truncate">{c.name}</span>
                    <span className="block text-xs text-muted truncate">
                      {c.phone || "No phone"}
                      {c.group_name ? ` · ${c.group_name}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </ScrollArea>
        </div>
      )}
      {open && !isFetching && results.length === 0 && !showClearRow && debounced.length >= 2 && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full mt-1 z-50 card shadow-lg px-3 py-2.5 text-sm text-muted"
          onMouseDown={(e) => e.stopPropagation()}
        >
          No customers match “{debounced}”
        </div>
      )}
    </div>
  );
}