import DatePicker from "./DatePicker";

export interface DateRangePickerProps {
  /** "YYYY-MM-DD" or "" for no lower bound. */
  from: string;
  /** "YYYY-MM-DD" or "" for no upper bound. */
  to: string;
  onChange: (from: string, to: string) => void;
  /** Optional label shown above the pair (e.g. "Created"). */
  label?: string;
  fromPlaceholder?: string;
  toPlaceholder?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  /** Hard upper bound applied to both pickers. */
  maxDate?: string;
}

export default function DateRangePicker({
  from,
  to,
  onChange,
  label,
  fromPlaceholder,
  toPlaceholder,
  ariaLabel,
  className,
  inputClassName,
  disabled = false,
  maxDate,
}: DateRangePickerProps) {
  const handleFrom = (v: string) => {
    if (v && to && v > to) onChange(v, "");
    else onChange(v, to);
  };
  const handleTo = (v: string) => {
    onChange(from, v);
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? (label ? `${label} range` : "Date range")}
      className={`flex items-center ${label ? "flex-col items-stretch gap-0.5" : "gap-1"} ${className ?? ""}`}
    >
      {label && <span className="text-xs text-muted">{label}</span>}
      <div className="flex items-center gap-1">
        <DatePicker
          value={from}
          onChange={handleFrom}
          mode="date"
          placeholder={fromPlaceholder ?? "From"}
          ariaLabel={label ? `${label} from` : "From date"}
          inputClassName={inputClassName}
          disabled={disabled}
          max={to || maxDate || undefined}
        />
        <span className="text-faint select-none" aria-hidden="true">–</span>
        <DatePicker
          value={to}
          onChange={handleTo}
          mode="date"
          placeholder={toPlaceholder ?? "To"}
          ariaLabel={label ? `${label} to` : "To date"}
          inputClassName={inputClassName}
          disabled={disabled}
          min={from || undefined}
          max={maxDate}
        />
      </div>
    </div>
  );
}