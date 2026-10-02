import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X, GripVertical } from "lucide-react";
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
  ariaLabel?: string;
  actions?: ReactNode;
  breadcrumb?: string;
}

const CLOSE_THRESHOLD = 120;

export default function SlideOver({ open, onClose, title, children, wide, ariaLabel, actions, breadcrumb }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useBreadcrumbExtension(breadcrumb ?? (typeof title === "string" ? title : undefined), open);
  useLockBodyScroll(open);
  useTrapFocus(panelRef, open, onClose);

  useEffect(() => {
    if (!open) setDragOffset(0);
  }, [open]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [role='button'], [role='tab']")) return;
    dragStartX.current = e.clientX;
    setDragging(true);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const delta = e.clientX - dragStartX.current;
    setDragOffset(delta > 0 ? delta : 0);
  }, [dragging]);

  const finishDrag = useCallback((clientX: number) => {
    setDragging(false);
    if (clientX - dragStartX.current > CLOSE_THRESHOLD) onClose();
    else setDragOffset(0);
  }, [onClose]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => finishDrag(e.clientX), [finishDrag]);
  const handlePointerCancel = useCallback(() => { setDragging(false); setDragOffset(0); }, []);

  if (!open) return null;

  const label = ariaLabel || (typeof title === "string" ? title : "Panel");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={label}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${dragOffset > 0 ? "opacity-80" : "opacity-100"}`} onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative h-full bg-surface shadow-2xl outline-none animate-slide-in flex flex-col overflow-hidden ${wide ? "w-full max-w-2xl" : "w-full max-w-xl"}`}
        style={{
          transform: dragOffset > 0 ? `translateX(${dragOffset}px)` : undefined,
          transition: dragging ? "none" : "transform 0.25s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between gap-3 p-6 border-b bg-surface touch-pan-y"
        >
          <div
            className="flex items-center self-stretch -my-6 pl-6 pr-2 -ml-6 touch-pan-y select-none"
            aria-label="Drag to close"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <span
              className="text-faint shrink-0 cursor-grab"
              title="Drag right to close"
              aria-hidden="true"
            >
              <GripVertical size={20} />
            </span>
          </div>
          <h2 className="text-lg font-bold flex-1 min-w-0 truncate">{title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button onClick={onClose} className="text-faint hover:text-muted" aria-label="Close panel">
              <X size={20} />
            </button>
          </div>
        </div>
        <ScrollArea
          className="flex-1 min-h-0"
          viewportClassName="h-full p-6 sa-viewport-contain"
        >
          {children}
        </ScrollArea>
      </div>
    </div>
  );
}
