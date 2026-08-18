import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Tags,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  Receipt,
  LogOut,
  Menu,
  Users as UsersIcon,
  History,
  BarChart3,
  Contact,
  Settings as SettingsIcon,
  MapPin,
  ClipboardList,
  Boxes,
  Layers,
  Fingerprint,
  PackageCheck,
  AlertTriangle,
  Factory,
  Workflow,
  FlaskConical,
  Sparkles,
  PackageOpen,
  TrendingUp,
  Sun,
  Moon,
  Monitor,
  CircleUser,
  PanelLeftClose,
  PanelLeftOpen,
  StickyNote,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import NotificationBell from "./NotificationBell";

const MIN_SIDEBAR_WIDTH = 208;
const DEFAULT_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 480;
const DESKTOP_MQ = "(min-width: 1024px)";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(DESKTOP_MQ).matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", perm: "dashboard.view" },
  { to: "/products", icon: Package, label: "Products", perm: "products.view" },
  { to: "/categories", icon: Tags, label: "Categories", perm: "categories.view" },
  { to: "/suppliers", icon: Truck, label: "Suppliers", perm: "suppliers.view" },
  { to: "/customers", icon: Contact, label: "Customers", perm: "customers.view" },
  { to: "/orders", icon: ShoppingCart, label: "Orders", perm: "orders.view" },
  { to: "/sales", icon: Receipt, label: "Sales", perm: "sales.view" },
  { to: "/locations", icon: MapPin, label: "Locations", perm: "locations.view" },
  { to: "/receiving", icon: PackageCheck, label: "Receiving", perm: "receipts.view" },
  { to: "/asns", icon: Truck, label: "ASNs", perm: "asns.view" },
  { to: "/lpns", icon: Boxes, label: "LPNs", perm: "lpns.view" },
  { to: "/lots", icon: Layers, label: "Lots", perm: "lots.view" },
  { to: "/serial-numbers", icon: Fingerprint, label: "Serial Numbers", perm: "serial_numbers.view" },
  { to: "/cycle-counts", icon: ClipboardList, label: "Cycle Counts", perm: "cycle_counts.view" },
  { to: "/boms", icon: Factory, label: "BOMs", perm: "bom.view" },
  { to: "/work-orders", icon: Workflow, label: "Work Orders", perm: "work_orders.view" },
  { to: "/planning", icon: Sparkles, label: "Planning", perm: "planning.view" },
  { to: "/forecasting", icon: TrendingUp, label: "Forecasting", perm: "forecasting.view" },
  { to: "/shipments", icon: PackageOpen, label: "Shipments", perm: "shipments.view" },
  { to: "/quality-checks", icon: FlaskConical, label: "Quality", perm: "quality_checks.view" },
  { to: "/stock-movements", icon: ArrowLeftRight, label: "Movements", perm: "stock.view" },
  { to: "/exceptions", icon: AlertTriangle, label: "Exceptions", perm: "reports.view" },
  { to: "/users", icon: UsersIcon, label: "Users", perm: "users.view" },
  { to: "/reports", icon: BarChart3, label: "Reports", perm: "reports.view" },
  { to: "/activity-log", icon: History, label: "Activity", perm: "activity.view" },
  { to: "/notes", icon: StickyNote, label: "Notes", perm: "notes.view" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", perm: "settings.view" },
  { to: "/profile", icon: CircleUser, label: "Profile", perm: "profile.view" },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH ? saved : DEFAULT_SIDEBAR_WIDTH;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem("sidebarCollapsed") === "1",
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user, can } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDesktop = useIsDesktop();
  const visibleNavItems = navItems.filter((item) => can(item.perm));

  const collapsed = isDesktop && sidebarCollapsed;

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      return next;
    });
  };

  const themeOptions: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
    { mode: "light", icon: Sun, label: "Light mode" },
    { mode: "system", icon: Monitor, label: "Follow system" },
    { mode: "dark", icon: Moon, label: "Dark mode" },
  ];

  const handleLogout = () => {
    logout();
    navigate("/login");
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
      <aside
        style={{ width: collapsed ? 0 : sidebarWidth }}
        aria-hidden={collapsed || undefined}
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar border-r border-border max-w-[85vw] overflow-hidden transform transition-transform lg:translate-x-0 lg:static lg:inset-auto lg:max-w-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:border-r-0 lg:invisible" : ""}`}
      >
        <nav className="sidebar-scroll flex-1 overflow-y-auto p-4 space-y-1">
          {visibleNavItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`sidebar-link ${isActive ? "active" : ""}`}
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
                  className="h-7 w-7 rounded-full object-cover border border-border shrink-0" />
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
            collapsed ? "hidden" : "hidden lg:block"
          }`}
        />
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between relative z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-muted lg:hidden" aria-label="Open navigation">
              <Menu size={24} />
            </button>
            <button
              onClick={toggleSidebarCollapsed}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:flex items-center justify-center p-1.5 rounded-md text-muted hover:text-ink hover:bg-subtle transition-colors"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </button>
            <div className="hidden lg:block text-lg font-semibold text-ink">Inventura Storage</div>
          </div>
          <div className="flex items-center gap-3">
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
                  className="h-7 w-7 rounded-full object-cover border border-border" />
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
        <main className="flex-1 overflow-auto p-6">
          <div className={collapsed ? "mx-auto max-w-7xl" : ""}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
