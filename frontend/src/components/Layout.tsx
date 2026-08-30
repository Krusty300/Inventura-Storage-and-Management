import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  LogOut,
  Menu,
  Sun,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import NotificationBell from "./NotificationBell";
import FloatingSidebar from "./FloatingSidebar";
import DateTimeDisplay from "./DateTimeDisplay";
import { navItems } from "../utils/navItems";

const MIN_SIDEBAR_WIDTH = 208;
const DEFAULT_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 480;
const MIN_FLOATING_WIDTH = 56;
const DEFAULT_FLOATING_WIDTH = 72;
const MAX_FLOATING_WIDTH = 200;
const TABLET_MQ = "(min-width: 768px)";
const DESKTOP_MQ = "(min-width: 1024px)";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH ? saved : DEFAULT_SIDEBAR_WIDTH;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem("sidebarCollapsed") === "1",
  );
  const [floatingWidth, setFloatingWidthState] = useState<number>(() => {
    const saved = Number(localStorage.getItem("floatingSidebarWidth"));
    return saved >= MIN_FLOATING_WIDTH && saved <= MAX_FLOATING_WIDTH ? saved : DEFAULT_FLOATING_WIDTH;
  });
  const floatingWidthRef = useRef(floatingWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  const setFloatingWidth = useCallback((w: number) => {
    setFloatingWidthState(w);
    floatingWidthRef.current = w;
    localStorage.setItem("floatingSidebarWidth", String(w));
  }, []);
  const location = useLocation();
  const { logout, completeLogout, loggingOut, user, can } = useAuth();
  const { theme, setTheme } = useTheme();
  const isTablet = useMediaQuery(TABLET_MQ);
  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const visibleNavItems = navItems.filter((item) => can(item.perm));

  const collapsed = isTablet && sidebarCollapsed;
  const overlay = collapsed && !isDesktop;

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebarCollapsed();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-global-search"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebarCollapsed]);

  const themeOptions: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
    { mode: "light", icon: Sun, label: "Light mode" },
    { mode: "system", icon: Monitor, label: "Follow system" },
    { mode: "dark", icon: Moon, label: "Dark mode" },
  ];

  const handleLogout = () => {
    logout();
    setTimeout(() => completeLogout(), 600);
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const width = Math.min(Math.max(ev.clientX, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
      setSidebarWidth(width);
      sidebarWidthRef.current = width;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("sidebarWidth", String(sidebarWidthRef.current));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div className="flex h-screen bg-app overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400">
        Skip to main content
      </a>
      <aside
        style={{ width: collapsed ? 0 : sidebarWidth }}
        aria-hidden={collapsed || undefined}
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar border-r border-border max-w-[85vw] overflow-hidden transform transition-transform md:translate-x-0 md:static md:inset-auto md:max-w-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:border-r-0 md:invisible" : ""}`}
      >
        <nav className="sidebar-scroll flex-1 overflow-y-auto p-4 space-y-1">
          {visibleNavItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`sidebar-link ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <Link to="/profile" className="flex items-center gap-2 min-w-0">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.username}
                  className="h-7 w-7 rounded-full object-cover border border-border shrink-0" loading="lazy" />
              ) : (
                <span
                  className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400
                    flex items-center justify-center text-xs font-semibold shrink-0"
                >
                  {user?.username.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-sm text-muted truncate hover:text-ink">{user?.username}</span>
            </Link>
            <button onClick={handleLogout} className="p-2 text-faint hover:text-ink shrink-0" title="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startResize}
          className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/70 active:bg-indigo-500 ${
            collapsed ? "hidden" : "hidden md:block"
          }`}
        />
      </aside>

      {collapsed && (
        <FloatingSidebar
          onExpand={toggleSidebarCollapsed}
          onClose={toggleSidebarCollapsed}
          width={floatingWidth}
          onWidthChange={setFloatingWidth}
          minWidth={MIN_FLOATING_WIDTH}
          maxWidth={MAX_FLOATING_WIDTH}
          overlay={overlay}
        />
      )}

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className="flex-1 flex flex-col min-w-0"
        style={collapsed && !overlay ? { marginLeft: floatingWidth } : undefined}
      >
        <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between relative z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-muted md:hidden" aria-label="Open navigation">
              <Menu size={24} />
            </button>
            <button
              onClick={toggleSidebarCollapsed}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden md:flex items-center justify-center p-1.5 rounded-md text-muted hover:text-ink hover:bg-subtle transition-colors"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </button>
            <div className="hidden md:block text-lg font-semibold text-ink">Inventura Storage</div>
          </div>
          <div className="flex items-center gap-3">
            <DateTimeDisplay />
            <div
              role="group"
              aria-label="Color theme"
              className="flex items-center rounded-lg border border-border bg-subtle p-0.5"
            >
              {themeOptions.map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  title={label}
                  aria-label={label}
                  onClick={() => setTheme(mode)}
                  className={`p-1.5 rounded-md transition-colors ${
                    theme === mode
                      ? "bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm"
                      : "text-faint hover:text-ink"
                  }`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
            <NotificationBell />
            <Link to="/profile" className="hidden sm:flex items-center gap-2 text-sm text-muted hover:text-ink">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.username}
                  className="h-7 w-7 rounded-full object-cover border border-border" loading="lazy" />
              ) : (
                <span
                  className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400
                    flex items-center justify-center text-xs font-semibold"
                >
                  {user?.username.charAt(0).toUpperCase()}
                </span>
              )}
              {user?.username}
            </Link>
          </div>
        </header>
        <main id="main-content" className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {loggingOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-app/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-3 px-6 py-3 rounded-xl bg-surface border border-border shadow-lg">
            <div className="h-4 w-4 rounded bg-subtle-strong animate-pulse" />
            <span className="text-sm font-medium text-ink">Signing out</span>
          </div>
        </div>
      )}
    </div>
  );
}
