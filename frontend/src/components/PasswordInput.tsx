import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export default function PasswordInput({ id, value, onChange, autoComplete, minLength, placeholder, className, ariaLabel }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        className={`${className ?? ""} input pr-10`.trim()}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        required
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 pr-3 flex items-center text-faint hover:text-muted"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}
