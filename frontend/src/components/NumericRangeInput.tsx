import { useId } from "react";

export interface NumericRangeInputProps {
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  /** Optional label shown leading the controls (e.g. "Price"). */
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Hard lower bound for both inputs. */
  hardMin?: number;
  /** Hard upper bound for both inputs. */
  hardMax?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

export default function NumericRangeInput({
  min,
  max,
  onChange,
  label,
  placeholder = "Any",
  ariaLabel,
  hardMin,
  hardMax,
  step,
  className,
  disabled = false,
}: NumericRangeInputProps) {
  const id = useId();

  const handleMin = (v: string) => {
    if (v !== "" && max !== "" && !Number.isNaN(Number(v)) && Number(v) > Number(max)) {
      onChange(v, "");
    } else {
      onChange(v, max);
    }
  };
  const handleMax = (v: string) => {
    onChange(min, v);
  };

  const base = "input text-sm py-1.5";
  const numberInputProps = {
    type: "number",
    inputMode: "decimal" as const,
    disabled: disabled,
    min: hardMin,
    max: hardMax,
    step: step ?? "any",
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? (label ? `${label} range` : "Numeric range")}
      className={`flex items-center gap-1.5 ${className ?? ""}`}
    >
      {label && <span className="text-xs text-muted whitespace-nowrap">{label}</span>}
      <input
        {...numberInputProps}
        id={`${id}-min`}
        aria-label={label ? `${label} minimum` : "Minimum"}
        placeholder={placeholder}
        value={min}
        onChange={(e) => handleMin(e.target.value)}
        className={base}
      />
      <span className="text-faint select-none" aria-hidden="true">–</span>
      <input
        {...numberInputProps}
        id={`${id}-max`}
        aria-label={label ? `${label} maximum` : "Maximum"}
        placeholder={placeholder}
        value={max}
        onChange={(e) => handleMax(e.target.value)}
        className={base}
      />
    </div>
  );
}