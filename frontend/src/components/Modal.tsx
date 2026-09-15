import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import ScrollArea from "./ScrollArea";
import { useBreadcrumbExtension } from "../context/BreadcrumbContext";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import { useTrapFocus } from "../hooks/useTrapFocus";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  xwide?: boolean;
  ariaLabel?: string;
  breadcrumb?: string;
}

export default function Modal({ open, onClose, title, children, wide, xwide, ariaLabel, breadcrumb }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useBreadcrumbExtension(breadcrumb ?? (typeof title === "string" ? title : undefined), open);
  useLockBodyScroll(open);
  useTrapFocus(panelRef, open, onClose);

  if (!open) return null;

  const label = ariaLabel ?? (typeof title === "string" ? title : "Dialog");

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-surface rounded-xl shadow-xl w-full max-h-[90vh] m-4 outline-none flex flex-col overflow-hidden ${xwide ? "max-w-3xl" : wide ? "max-w-2xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b shrink-0">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-faint hover:text-muted" aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        <ScrollArea className="flex-1 min-h-0" viewportClassName="h-full p-6 sa-viewport-contain">
          {children}
        </ScrollArea>
      </div>
    </div>
  );
}
