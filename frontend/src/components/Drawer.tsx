import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, GripVertical } from "lucide-react";
import ScrollArea from "./ScrollArea";
import { useBreadcrumbExtension } from "../context/BreadcrumbContext";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  ariaLabel?: string;
  actions?: ReactNode;
  breadcrumb?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
const CLOSE_THRESHOLD = 120;

interface DrawerPortalProps {
  open: boolean;
  children: ReactNode;
}

/** DrawerPortal - renders the drawer into a top-level container via a portal. */
export function DrawerPortal({ open, children }: DrawerPortalProps) {
  if (!open) return null;
  return createPortal(children, document.body);
}

/** DrawerOverlay - the dimmed scrim behind the popup. Clicking it closes the drawer. */
export function DrawerOverlay({ onClick }: { onClick: () => void }) {
  return (
    <div className="absolute inset-0 bg-black/40" onClick={onClick} aria-hidden="true" />
  );
}

/** DrawerViewport - a fixed full-screen stage that anchors the popup to the right edge. */
export function DrawerViewport({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full items-center justify-end">{children}</div>;
}

interface DrawerPopupProps {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  wide?: boolean;
}

/** DrawerPopup - the actual vertical drawer panel (right side, full width on mobile). */
export function DrawerPopup({ children, onClose, open, wide }: DrawerPopupProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dragStartClientX = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    if (!dragging) setDragOffset(0);
  }, [dragging]);

  useEffect(() => {
    if (!open) setDragOffset(0);
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
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [role='button']")) return;
    dragStartClientX.current = e.clientX;
    setDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const delta = e.clientX - dragStartClientX.current;
      setDragOffset(delta > 0 ? delta : 0);
    },
    [dragging],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      setDragging(false);
      if (e.clientX - dragStartClientX.current > CLOSE_THRESHOLD) onClose();
      else setDragOffset(0);
    },
    [dragging, onClose],
  );

  const handlePointerCancel = useCallback(() => {
    setDragging(false);
    setDragOffset(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    panelRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={`relative h-full bg-surface shadow-2xl outline-none flex flex-col overflow-hidden ${wide ? "w-full max-w-2xl" : "w-full max-w-xl"}`}
      style={{
        transform: dragOffset > 0 ? `translateX(${dragOffset}px)` : undefined,
        transition: dragging ? "none" : "transform 0.25s ease",
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {children}
    </div>
  );
}

export default function Drawer({
  open,
  onClose,
  title,
  children,
  wide,
  ariaLabel,
  actions,
  breadcrumb,
}: DrawerProps) {
  const label = ariaLabel || (typeof title === "string" ? title : "Panel");

  useBreadcrumbExtension(breadcrumb ?? (typeof title === "string" ? title : undefined), open);

  return (
    <DrawerPortal open={open}>
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
        <DrawerOverlay onClick={onClose} />
        <DrawerViewport>
          <DrawerPopup onClose={onClose} open={open} wide={wide}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 p-6 border-b bg-surface">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-faint shrink-0 cursor-grab select-none" title="Drag right to close" aria-label="Drag to close">
                  <GripVertical size={20} />
                </span>
                <h2 className="text-lg font-bold flex-1 min-w-0 truncate">{title}</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {actions}
                <button onClick={onClose} className="text-faint hover:text-muted" aria-label="Close drawer">
                  <X size={20} />
                </button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0" viewportClassName="h-full p-6">
              {children}
            </ScrollArea>
          </DrawerPopup>
        </DrawerViewport>
      </div>
    </DrawerPortal>
  );
}
