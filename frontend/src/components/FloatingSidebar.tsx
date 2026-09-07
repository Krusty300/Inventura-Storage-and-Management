import { useState, useEffect, useRef, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { PanelLeftOpen, LogOut, ChevronRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import ScrollArea from "./ScrollArea";
import { navGroups, type NavItem } from "../utils/navItems";

const LABEL_BREAKPOINT = 80;

interface FloatingSidebarProps {
  onExpand: () => void;
  onClose?: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  minWidth: number;
  maxWidth: number;
  overlay?: boolean;
}

function FloatingTooltip({ item, side, id }: { item: NavItem; side: "right" | "left"; id: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap z-50 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 shadow-lg pointer-events-none ${
        side === "right" ? "left-full ml-2" : "right-full mr-2"
      }`}
    >
      {item.label}
    </span>
  );
}

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem("collapsedNavGroups");
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function writeCollapsedGroups(ids: Set<string>) {
  localStorage.setItem("collapsedNavGroups", JSON.stringify([...ids]));
}

export default function FloatingSidebar({ onExpand, onClose, width, onWidthChange, minWidth, maxWidth, overlay }: FloatingSidebarProps) {
  const location = useLocation();
  const { can, logout, completeLogout, user } = useAuth();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [tooltipSide, setTooltipSide] = useState<"right" | "left">("right");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const navRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);
  const showLabels = width >= LABEL_BREAKPOINT;

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, onClose]);

  const hasNavigated = useRef(false);
  useEffect(() => {
    if (!hasNavigated.current) { hasNavigated.current = true; return; }
    if (overlay) onClose?.();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      writeCollapsedGroups(next);
      return next;
    });
  }, []);

  const activeGroupId = navGroups.find((g) =>
    g.items.some((item) => location.pathname === item.to)
  )?.id;

  const measureTooltip = useCallback((key: string) => {
    if (!navRef.current) return;
    const el = navRef.current.querySelector<HTMLElement>(`[data-nav="${key}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    setTooltipSide(spaceRight < 220 ? "left" : "right");
  }, []);

  useEffect(() => {
    if (hoveredKey) measureTooltip(hoveredKey);
  }, [hoveredKey, measureTooltip]);

  const handleLogout = () => {
    logout();
    setTimeout(() => completeLogout(), 600);
  };

  const handleNavClick = () => {
    if (overlay) onClose?.();
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth);
      onWidthChange(newWidth);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <>
      {overlay && (
        <div
          className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
          onClick={() => onClose?.()}
          aria-hidden="true"
        />
      )}
      <nav
        ref={navRef}
        aria-label="Collapsed navigation"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-surface/80 backdrop-blur-md border-r border-border overflow-hidden no-transition animate-slide-in-left ${
          overlay ? "" : "hidden md:flex"
        }`}
        style={{ width }}
      >
        <ScrollArea className="flex-1 min-h-0" viewportClassName="h-full w-full py-2 relative sa-viewport-contain">
          {navGroups.map((group, gi) => {
            const visibleToRole = !group.roles || group.roles.includes(user?.role ?? "");
            const visibleItems = group.items.filter((item) => can(item.perm));
            if (!visibleToRole || visibleItems.length === 0) return null;
            const isGroupActive = group.id === activeGroupId;
            const isGroupCollapsed = showLabels && collapsedGroups.has(group.id);
            return (
              <div key={group.id}>
                {gi > 0 && visibleItems.length > 0 && (
                  <div className="mx-2 my-1 border-t border-border/60" aria-hidden="true" />
                )}
                {showLabels && (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center gap-1 px-3 pt-2 pb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-faint hover:text-muted transition-colors"
                    aria-expanded={!isGroupCollapsed}
                  >
                    <ChevronRight
                      size={12}
                      className={`shrink-0 transition-transform duration-150 ${isGroupCollapsed ? "" : "rotate-90"}`}
                    />
                    <span className={`truncate ${isGroupActive ? "text-primary dark:text-primary" : ""}`}>
                      {group.label}
                    </span>
                  </button>
                )}
                {!isGroupCollapsed && visibleItems.map((item) => {
                  const isActive = location.pathname === item.to;
                  const slug = item.to === "/" ? "home" : item.to.replace(/\//g, "-");
                  const tooltipId = `nav-tooltip-${slug}`;
                  return (
                    <div key={item.to} className="relative px-1.5 my-0.5">
                      <Link
                        to={item.to}
                        onClick={handleNavClick}
                        aria-label={item.label}
                        aria-current={isActive ? "page" : undefined}
                        aria-describedby={hoveredKey === item.to && !showLabels ? tooltipId : undefined}
                        data-nav={item.to}
                        onMouseEnter={() => setHoveredKey(item.to)}
                        onMouseLeave={() => setHoveredKey(null)}
                        onFocus={() => setHoveredKey(item.to)}
                        onBlur={() => setHoveredKey(null)}
                        className={`relative flex items-center gap-2.5 rounded-lg transition-colors overflow-hidden ${
                          showLabels ? "px-2.5 h-9" : "justify-center w-9 h-9"
                        } ${
                          isActive
                            ? "bg-primary-soft text-primary dark:bg-primary/15 dark:text-primary"
                            : "text-muted hover:text-ink hover:bg-subtle"
                        }`}
                      >
                        {isActive && (
                          <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-5 rounded-full bg-primary" />
                        )}
                        <item.icon size={20} className="shrink-0" />
                        {showLabels && (
                          <span className="text-sm truncate">{item.label}</span>
                        )}
                      </Link>
                      {hoveredKey === item.to && !showLabels && (
                        <FloatingTooltip
                          item={item}
                          side={tooltipSide}
                          id={tooltipId}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </ScrollArea>

        <div className="shrink-0 w-full border-t border-border py-2 px-1.5 relative">
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={onExpand}
              aria-label="Expand sidebar"
              title="Expand sidebar (Ctrl+B)"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-ink hover:bg-subtle transition-colors"
            >
              <PanelLeftOpen size={20} />
            </button>

            <Link
              to="/profile"
              onClick={handleNavClick}
              aria-label="Profile"
              className="flex items-center justify-center w-9 h-9 rounded-lg overflow-hidden"
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="h-8 w-8 rounded-full object-cover border border-border"
                  loading="lazy"
                />
              ) : (
                <span className="h-8 w-8 rounded-full bg-primary-soft dark:bg-primary/20 text-primary-strong dark:text-primary flex items-center justify-center text-xs font-semibold">
                  {user?.username?.charAt(0).toUpperCase()}
                </span>
              )}
            </Link>

            <button
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize collapsed sidebar"
          onPointerDown={startResize}
          className="absolute top-0 right-0 h-full w-3 cursor-col-resize z-10 flex items-center justify-center group/resize"
        >
          <div className="w-0.5 h-8 rounded-full bg-transparent group-hover/resize:bg-primary/50 group-active/resize:bg-primary transition-colors" />
        </div>
      </nav>
    </>
  );
}
