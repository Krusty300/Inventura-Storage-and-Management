import type { ChangeEvent } from "react";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  maxLength?: number;
}

export default function TextArea({
  id,
  value,
  onChange,
  rows = 3,
  placeholder,
  ariaLabel,
  disabled,
  required,
  className,
  maxLength,
}: Props) {
  return (
    <textarea
      id={id}
      className={["input", className].filter(Boolean).join(" ")}
      rows={rows}
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      required={required}
      maxLength={maxLength}
    />
  );
}