import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface ExpandableTabsTab<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface Props<T extends string> {
  /** Ordered tab defs; the pill bar mirrors this order left-to-right. */
  tabs: readonly ExpandableTabsTab<T>[];
  /** Currently active tab id (controlled). */
  value: T;
  onChange: (value: T) => void;
  /** Panel content rendered above the pill bar for the active tab. */
  children?: ReactNode;
  /** Alternative to `children`: receives the active tab so the panel can vary. */
  renderPanel?: (active: ExpandableTabsTab<T>) => ReactNode;
  /** Stable prefix for the generated ARIA ids. */
  id?: string;
  ariaLabel?: string;
  /** Where to render the pill bar relative to the panel. */
  position?: "top" | "bottom";
  /**
   * Treat the value as a route path: the active tab is the exact id match,
   * or (falling back) the longest tab id that the current path starts with.
   * Useful for navigation bars where detail routes live under a tab's path.
   */
  matchByPrefix?: boolean;
  className?: string;
  panelClassName?: string;
}

type Direction = "left" | "right";

const SLIDE_STYLES = `
@keyframes expandable-tabs-slide-right {
  from { opacity: 0; transform: translateX(32px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes expandable-tabs-slide-left {
  from { opacity: 0; transform: translateX(-32px); }
  to { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .expandable-tabs-panel {
    animation: none !important;
  }
}
`;

const slideAnimation = (direction: Direction) =>
  direction === "right"
    ? "expandable-tabs-slide-right 280ms cubic-bezier(0.4, 0, 0.2, 1)"
    : "expandable-tabs-slide-left 280ms cubic-bezier(0.4, 0, 0.2, 1)";

export default function ExpandableTabs<T extends string>({
  tabs,
  value,
  onChange,
  children,
  renderPanel,
  id,
  ariaLabel = "View mode",
  position = "bottom",
  matchByPrefix = false,
  className = "",
  panelClassName = "",
}: Props<T>) {
  const generatedId = useId();
  const baseId = id ?? `expandable-tabs-${generatedId.replace(/:/g, "")}`;
  const panelId = `${baseId}-panel`;

  const exactIndex = tabs.findIndex((t) => t.id === value);
  let activeIndex = exactIndex;
  if (matchByPrefix && exactIndex === -1) {
    let best = 0;
    let bestLength = -1;
    for (let i = 0; i < tabs.length; i += 1) {
      const tabId = tabs[i].id;
      if (value.startsWith(tabId) && tabId.length > bestLength) {
        bestLength = tabId.length;
        best = i;
      }
    }
    activeIndex = best;
  }
  if (activeIndex < 0) activeIndex = 0;
  const activeTab = tabs[activeIndex] ?? tabs[0];

  const [direction, setDirection] = useState<Direction>("right");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const select = useCallback(
    (next: T) => {
      const nextIndex = tabs.findIndex((t) => t.id === next);
      setDirection(nextIndex >= activeIndex ? "right" : "left");
      onChange(next);
    },
    [activeIndex, onChange, tabs],
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(activeIndex + step + tabs.length) % tabs.length];
    select(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  };

  const panelContent = children ?? (renderPanel ? renderPanel(activeTab) : null);

  const panel = (
    <div className={`relative ${panelClassName}`}>
      <div
        key={activeTab.id}
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${baseId}-tab-${activeTab.id}`}
        data-direction={direction}
        className="expandable-tabs-panel"
        style={mounted ? { animation: slideAnimation(direction) } : undefined}
      >
        {panelContent}
      </div>
    </div>
  );

  const bar = (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="self-center max-w-full inline-flex items-center gap-1 rounded-full border border-border bg-subtle p-1 shadow-sm overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const TabIcon = tab.icon;
        const active = tab.id === activeTab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={panelId}
            title={tab.label}
            className={`group inline-flex h-8 max-w-full items-center rounded-full px-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              active
                ? "bg-surface text-primary shadow-sm dark:bg-primary/20 dark:text-primary"
                : "text-muted hover:bg-subtle-strong hover:text-ink"
            }`}
            onClick={() => select(tab.id)}
          >
            <TabIcon size={16} className="shrink-0 transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
            <span
              className={`grid overflow-hidden whitespace-nowrap transition-all duration-300 ease-out ${
                active
                  ? "ml-1.5 w-auto opacity-100 [grid-template-columns:1fr]"
                  : "ml-0 w-0 opacity-0 [grid-template-columns:0fr]"
              }`}
            >
              <span className="overflow-hidden text-sm font-medium">{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <style>{SLIDE_STYLES}</style>
      {position === "top" ? bar : panel}
      {position === "top" ? panel : bar}
    </div>
  );
}