import type { ReactNode } from "react";
import { RotateCcw, Search } from "lucide-react";
import FittedSelect, { type FittedSelectOption } from "./FittedSelect";

export type FilterBarSelectOption = Omit<FittedSelectOption, "value"> & { value: string };

export type FilterBarItem =
  | {
      type: "search";
      placeholder?: string;
      ariaLabel?: string;
      className?: string;
      onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    }
  | {
      type: "select";
      key: string;
      ariaLabel: string;
      /** Label for the "empty / all" option; prepended automatically. Exclude the empty option from `options`. */
      placeholder?: string;
      options: FilterBarSelectOption[];
      maxWidth?: number;
      className?: string;
    }
  | {
      type: "custom";
      key?: string;
      /** Render slot for richer filters (DatePicker, DateRangePicker, ...). */
      render: (args: { value: string; onChange: (value: string) => void }) => ReactNode;
      className?: string;
    };

interface FilterBarProps {
  items: FilterBarItem[];
  /** Current values keyed by filter key; search lives under key "search". */
  values: Record<string, string>;
  /** Handles { key: "search" } for the search box and other keys for filters. */
  setFilter: (key: string, value: string) => void;
  /** When provided, renders a "Clear filters" action once any item has a value. */
  onReset?: () => void;
  /** Target column count on large screens (responsive grid underneath). */
  columns?: 2 | 3 | 4;
  className?: string;
}

const GRID_COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

function isActive(key: string, values: Record<string, string>) {
  return !!key && !!values[key];
}

export default function FilterBar({
  items,
  values,
  setFilter,
  onReset,
  columns = 4,
  className = "",
}: FilterBarProps) {
  const activeKeys: string[] = [];
  for (const item of items) {
    if (item.type === "search") activeKeys.push("search");
    else if (item.key) activeKeys.push(item.key);
  }
  const showReset = onReset && activeKeys.some((key) => isActive(key, values));

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 items-center ${GRID_COLS[columns]} ${className}`}>
      {items.map((item, index) => {
        if (item.type === "search") {
          const ariaLabel = item.ariaLabel ?? "Search";
          const placeholder = item.placeholder ?? "Search...";
          return (
            <div key={index} className={`relative ${item.className ?? "sm:col-span-2 lg:col-span-2"}`}>
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                className="input pl-10"
                placeholder={placeholder}
                aria-label={ariaLabel}
                value={values.search ?? ""}
                onChange={(e) => setFilter("search", e.target.value)}
                onKeyDown={item.onKeyDown}
              />
            </div>
          );
        }

        if (item.type === "select") {
          const emptyOption: FilterBarSelectOption = { value: "", label: item.placeholder ?? "All" };
          return (
            <div key={index} className={item.className ?? ""}>
              <FittedSelect
                value={values[item.key] ?? ""}
                onChange={(value) => setFilter(item.key, value)}
                ariaLabel={item.ariaLabel}
                maxWidth={item.maxWidth}
                options={[emptyOption, ...item.options]}
              />
            </div>
          );
        }

        const key = item.key ?? "";
        return (
          <div key={index} className={item.className ?? ""}>
            {item.render({
              value: key ? (values[key] ?? "") : "",
              onChange: (value) => setFilter(key, value),
            })}
          </div>
        );
      })}

      {showReset && (
        <div className="flex items-center justify-end" key="reset">
          <button
            type="button"
            onClick={onReset}
            className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5 transition-colors"
            aria-label="Clear filters"
          >
            <RotateCcw size={14} />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}