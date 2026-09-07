import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import ScrollArea from "./ScrollArea";

export interface FittedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options.find((o) => o.value === value);

  const resetHighlight = () => setHighlight(selectedIndex >= 0 ? selectedIndex : 0);

  useEffect(() => {
    if (open && disabled) setOpen(false);
  }, [open, disabled]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw) return;
    const match = options.find((o) => o.value === raw) ?? options.find((o) => o.label === raw);
    if (match && !match.disabled) onChange(match.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) resetHighlight();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) resetHighlight();
      setOpen(true);
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && options[highlight] && !options[highlight].disabled) {
        onChange(options[highlight].value);
        setOpen(false);
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
          value={selected?.label ?? ""}
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
      <ScrollArea
        id={listId}
        role="listbox"
        aria-label={ariaLabel ? `${ariaLabel} options` : undefined}
        style={{ maxWidth: `min(${maxWidth}px, calc(100vw - 2rem))` }}
        className={`absolute left-0 top-full mt-1 z-50 min-w-full w-max rounded-lg border border-border-strong bg-surface shadow-lg transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        viewportClassName="max-h-56 px-1 py-1 sa-viewport-contain"
      >
        {options.map((o, i) => (
          <li key={o.value}>
            <button
              type="button"
              role="option"
              id={`${listId}-${i}`}
              aria-selected={o.value === value}
              aria-disabled={o.disabled}
              tabIndex={open && i === highlight ? 0 : -1}
              disabled={o.disabled}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`block w-full text-left px-2 py-2 text-sm whitespace-nowrap rounded-md transition-colors ${
                o.value === value
                  ? "bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary font-medium"
                  : "text-ink hover:bg-subtle"
              } ${open && i === highlight ? "bg-subtle" : ""}`}
            >
              {o.label}
            </button>
          </li>
        ))}
        {options.length === 0 && (
          <li className="px-2 py-2 text-sm text-muted whitespace-nowrap">No options</li>
        )}
      </ScrollArea>
    </div>
  );
}