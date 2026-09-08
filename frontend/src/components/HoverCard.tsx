import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface HoverCardProps {
  children: React.ReactNode;
  render: (close: () => void) => React.ReactNode;
  width?: number;
}

const HOVER_CARD_HEIGHT = 320;

export default function HoverCard({ children, render, width = 320 }: HoverCardProps) {
  const [hover, setHover] = useState<{ left: number; top: number } | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [hover]);

  useEffect(
    () => () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const close = () => setHover(null);

  const show = (e: React.MouseEvent) => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const roomBelow = rect.bottom + 8 + HOVER_CARD_HEIGHT <= vh - 8;
    setHover({
      left,
      top: roomBelow ? rect.bottom + 8 : Math.max(8, rect.top - HOVER_CARD_HEIGHT - 8),
    });
  };

  const hide = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHover(null);
  };

  const scheduleHide = () => {
    if (hover == null) return;
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(hide, 120);
  };

  const cancelHide = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  return (
    <>
      <span className="inline-flex" onMouseEnter={show} onMouseLeave={scheduleHide}>
        {children}
      </span>
      {hover &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={cancelHide}
            onMouseLeave={hide}
            style={{ position: "fixed", left: hover.left, top: hover.top, width }}
            className="z-50 rounded-xl border border-border-strong bg-surface shadow-xl text-sm"
          >
            {render(close)}
          </div>,
          document.body,
        )}
    </>
  );
}