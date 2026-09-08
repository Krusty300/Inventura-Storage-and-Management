import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import ScrollArea from "./ScrollArea";

export interface FittedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Nested sub-options rendered inline under this (group) option. */
  children?: FittedSelectOption[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: FittedSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  maxWidth?: number;
}

const GAP = 4;
const VIEWPORT_MARGIN = 8;
const MAX_MENU_HEIGHT = 224;

interface MenuPosition {
  left: number;
  minWidth: number;
  top?: number;
  bottom?: number;
}

interface Row extends FittedSelectOption {
  key: string;
  parentLabel?: string;
  depth: number;
  expanded?: boolean;
  /** True when the row is a group header (has selectable children). */
  isGroup: boolean;
}

export default function FittedSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled = false,
  ariaLabel,
  maxWidth = 460,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [pos, setPos] = useState<MenuPosition>({ left: 0, minWidth: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const isAncestorOf = useCallback(
    (parentValue: string, targetValue: string): boolean => {
      for (const o of options) {
        if (o.value === parentValue) {
          if (o.value === targetValue) return true;
          return !!o.children && o.children.some((c) => c.value === targetValue);
        }
      }
      return false;
    },
    [options],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const o of options) {
      const hasChildren = !!o.children && o.children.length > 0;
      const groupOpen = hasChildren && (expanded.has(o.value) || isAncestorOf(o.value, value));
      if (groupOpen) {
        out.push({ ...o, key: `g:${o.value}`, depth: 0, expanded: true, isGroup: true });
        for (const c of o.children!) {
          out.push({ ...c, key: `o:${o.value}:${c.value}`, parentLabel: o.label, depth: 1, isGroup: false });
        }
      } else {
        out.push({ ...o, key: `o:${o.value}`, depth: 0, isGroup: hasChildren });
      }
    }
    return out;
  }, [options, expanded, value, isAncestorOf]);

  const selectedRowIndex = rows.findIndex((r) => r.value === value);
  const selected = selectedRowIndex >= 0 ? rows[selectedRowIndex] : undefined;

  const resetHighlight = () => setHighlight(selectedRowIndex >= 0 ? selectedRowIndex : 0);

  const toggleGroup = (groupValue: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupValue)) next.delete(groupValue);
      else next.add(groupValue);
      return next;
    });
  };

  const positionMenu = useCallback(
    () => {
      const wrapper = wrapperRef.current;
      const menu = menuRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const menuMaxW = Math.min(maxWidth, vw - VIEWPORT_MARGIN * 2);
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, vw - VIEWPORT_MARGIN - menuMaxW));
      const menuH = menu ? menu.offsetHeight : MAX_MENU_HEIGHT;
      const roomBelow = rect.bottom + GAP + menuH <= vh - VIEWPORT_MARGIN;
      const roomAbove = rect.top - GAP - menuH >= VIEWPORT_MARGIN;
      const up = !roomBelow && roomAbove;
      setPos({
        left,
        minWidth: rect.width,
        top: up ? undefined : rect.bottom + GAP,
        bottom: up ? vh - rect.top + GAP : undefined,
      });
    },
    [maxWidth],
  );

  useEffect(() => {
    if (open && disabled) setOpen(false);
  }, [open, disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    const retry = window.setTimeout(positionMenu, 0);
    window.addEventListener("resize", positionMenu);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onDocScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("scroll", onDocScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("scroll", onDocScroll, true);
    };
  }, [open]);

  const selectRow = (row: Row) => {
    if (row.disabled) return;
    if (row.isGroup) {
      toggleGroup(row.value);
      return;
    }
    onChange(row.value);
    setOpen(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw) return;
    const match = rows.find((r) => r.value === raw) ?? rows.find((r) => r.label === raw && !r.isGroup);
    if (match && !match.disabled && !match.isGroup) onChange(match.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) resetHighlight();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) resetHighlight();
      setOpen(true);
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && rows[highlight]) {
        selectRow(rows[highlight]);
      } else {
        resetHighlight();
        setOpen(true);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      resetHighlight();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
          className="input pr-9 cursor-pointer"
          value={selected ? (selected.parentLabel ? `${selected.parentLabel} · ${selected.label}` : selected.label) : ""}
          placeholder={placeholder}
          readOnly
          disabled={disabled}
          onChange={handleChange}
          onClick={() => {
            if (disabled) return;
            resetHighlight();
            setOpen((o) => !o);
          }}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown
          size={16}
          className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>
      {createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            minWidth: pos.minWidth,
            maxWidth: `min(${maxWidth}px, calc(100vw - 2rem))`,
          }}
          className={`z-50 rounded-lg border border-border-strong bg-surface shadow-lg transition-opacity ${
            open ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <ScrollArea
            id={listId}
            role="listbox"
            aria-label={ariaLabel ? `${ariaLabel} options` : undefined}
            viewportClassName="max-h-56 px-1.5 py-1.5 sa-viewport-contain"
          >
            {rows.map((r, i) => (
              <li key={r.key}>
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={r.value === value}
                  aria-disabled={r.disabled}
                  tabIndex={open && i === highlight ? 0 : -1}
                  disabled={r.disabled}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => selectRow(r)}
                  className={`block w-full text-left px-3 py-2 text-sm leading-relaxed whitespace-nowrap rounded-md transition-colors ${
                    r.value === value
                      ? "bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary font-medium"
                      : "text-ink hover:bg-subtle"
                  } ${open && i === highlight ? "bg-subtle" : ""} ${r.depth > 0 ? "pl-6" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2 min-w-0">
                    <span className="min-w-0 truncate">{r.label}</span>
                    {r.isGroup && (
                      <ChevronRight
                        size={14}
                        className={`shrink-0 text-faint transition-transform ${r.expanded ? "rotate-90" : ""}`}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted whitespace-nowrap">No options</li>
            )}
          </ScrollArea>
        </div>,
        document.body,
      )}
    </div>
  );
}