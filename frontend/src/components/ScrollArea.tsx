import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export type ScrollDirection = "vertical" | "horizontal" | "both";

interface Metrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

const EMPTY_METRICS: Metrics = {
  scrollTop: 0,
  scrollHeight: 1,
  clientHeight: 1,
  scrollLeft: 0,
  scrollWidth: 1,
  clientWidth: 1,
};

const MIN_THUMB_PX = 28;

interface ScrollAreaProps extends HTMLAttributes<HTMLElement> {
  /** Element rendered as the outer (non-scrolling) wrapper. Defaults to `div`. */
  as?: ElementType;
  /** Which axes may scroll. Defaults to `"vertical"`. */
  direction?: ScrollDirection;
  /** Extra classes for the inner scroll container (the viewport). */
  viewportClassName?: string;
  children?: ReactNode;
}

/**
 * Smoothly-scrolling container with a themed custom scrollbar for the
 * vertical and horizontal axes. The content scrolls natively underneath
 * (so touch momentum, overscroll and keyboard/AT scrolling keep working)
 * while a lightweight overlay thumb is drawn on hover.
 *
 * On touch devices the custom thumb is hidden and the browser's native
 * (thin, themed) scrollbar is exposed instead.
 */
export default function ScrollArea({
  as: Tag = "div",
  children,
  direction = "vertical",
  className,
  viewportClassName,
  ...rest
}: ScrollAreaProps) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const metricsRef = useRef<Metrics>(EMPTY_METRICS);
  const dragRef = useRef<{ axis: "v" | "h"; start: number; offset: number } | null>(null);
  const vThumbRef = useRef<HTMLDivElement | null>(null);
  const hThumbRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [thumbHot, setThumbHot] = useState(false);

  const update = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const next: Metrics = {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
    metricsRef.current = next;
    setMetrics(next);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    update();
    const RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
    const ro = RO ? new RO(update) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [update, children]);

  const vOverflow = metrics.scrollHeight > metrics.clientHeight;
  const hOverflow = metrics.scrollWidth > metrics.clientWidth;

  const vThumbHeight =
    metrics.clientHeight > 0
      ? Math.min(metrics.clientHeight, Math.max(MIN_THUMB_PX, (metrics.clientHeight / metrics.scrollHeight) * metrics.clientHeight))
      : 0;
  const hThumbWidth =
    metrics.clientWidth > 0
      ? Math.min(metrics.clientWidth, Math.max(MIN_THUMB_PX, (metrics.clientWidth / metrics.scrollWidth) * metrics.clientWidth))
      : 0;

  const vScrollRange = metrics.scrollHeight - metrics.clientHeight;
  const hScrollRange = metrics.scrollWidth - metrics.clientWidth;
  const vTravel = metrics.clientHeight - vThumbHeight;
  const hTravel = metrics.clientWidth - hThumbWidth;
  const vTranslate = vScrollRange > 0 && vTravel > 0 ? (metrics.scrollTop / vScrollRange) * vTravel : 0;
  const hTranslate = hScrollRange > 0 && hTravel > 0 ? (metrics.scrollLeft / hScrollRange) * hTravel : 0;

  const beginDrag = (axis: "v" | "h", start: number, offset: number) => {
    dragRef.current = { axis, start, offset };
  };

  const pointerOverThumb = (clientX: number, clientY: number) => {
    for (const ref of [vThumbRef, hThumbRef]) {
      const el = ref.current;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return true;
      }
    }
    return false;
  };

  const thumbDownV = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(true);
    setThumbHot(true);
    beginDrag("v", e.clientY, metricsRef.current.scrollTop);
  };

  const thumbDownH = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(true);
    setThumbHot(true);
    beginDrag("h", e.clientX, metricsRef.current.scrollLeft);
  };

  const thumbMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = viewportRef.current;
    if (!drag || !el) return;
    const m = metricsRef.current;
    if (drag.axis === "v") {
      const range = m.scrollHeight - m.clientHeight;
      const travel = m.clientHeight - vThumbHeight;
      if (range <= 0 || travel <= 0) return;
      el.scrollTop = drag.offset + (e.clientY - drag.start) * (range / travel);
    } else {
      const range = m.scrollWidth - m.clientWidth;
      const travel = m.clientWidth - hThumbWidth;
      if (range <= 0 || travel <= 0) return;
      el.scrollLeft = drag.offset + (e.clientX - drag.start) * (range / travel);
    }
  };

  const thumbUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const dirClass =
    direction === "both" ? "sa-both" : direction === "horizontal" ? "sa-horizontal" : "sa-vertical";

  const thumbClass = (dir: "sa-thumb-v" | "sa-thumb-h") =>
    `sa-thumb ${dir}${hovering || dragging ? " sa-thumb-visible" : ""}${
      thumbHot || dragging ? " sa-thumb-hot" : ""
    }${dragging ? " sa-thumb-dragging" : ""}`;

  return (
    <Tag
      className={className ? `sa ${className}` : "sa"}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        setHovering(false);
        setThumbHot(false);
      }}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        if (hovering) setThumbHot(pointerOverThumb(e.clientX, e.clientY));
      }}
      {...rest}
    >
      <div
        ref={(node) => {
          viewportRef.current = node;
        }}
        onScroll={update}
        className={`sa-viewport ${dirClass}${viewportClassName ? ` ${viewportClassName}` : ""}`}
      >
        {children}
      </div>
      {direction !== "horizontal" && vOverflow && (
        <div
          ref={vThumbRef}
          role="presentation"
          onPointerDown={thumbDownV}
          onPointerMove={thumbMove}
          onPointerUp={thumbUp}
          onPointerCancel={thumbUp}
          className={thumbClass("sa-thumb-v")}
          style={{ height: vThumbHeight, transform: `translateY(${vTranslate}px)` }}
          aria-hidden="true"
        />
      )}
      {direction !== "vertical" && hOverflow && (
        <div
          ref={hThumbRef}
          role="presentation"
          onPointerDown={thumbDownH}
          onPointerMove={thumbMove}
          onPointerUp={thumbUp}
          onPointerCancel={thumbUp}
          className={thumbClass("sa-thumb-h")}
          style={{ width: hThumbWidth, transform: `translateX(${hTranslate}px)` }}
          aria-hidden="true"
        />
      )}
    </Tag>
  );
}