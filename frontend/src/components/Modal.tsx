import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import ScrollArea from "./ScrollArea";
import { useBreadcrumbExtension } from "../context/BreadcrumbContext";

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

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, wide, xwide, ariaLabel, breadcrumb }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useBreadcrumbExtension(breadcrumb ?? (typeof title === "string" ? title : undefined), open);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the panel after paint so the first focusable element receives focus
      requestAnimationFrame(() => {
        panelRef.current?.focus();
      });
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
        onKeyDown={handleKeyDown}
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
