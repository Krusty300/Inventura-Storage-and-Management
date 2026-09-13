import { useRef, type ReactNode } from "react";

interface Props {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  children: ReactNode;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export default function FileUploadButton({
  onFileChange,
  children,
  accept,
  multiple,
  disabled,
  className,
  ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onFileChange(e);
          e.target.value = "";
        }}
      />
    </>
  );
}