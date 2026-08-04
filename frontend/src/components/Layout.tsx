import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  PackageCheck,
  AlertTriangle,
  Factory,
  Workflow,
  FlaskConical,
  Sparkles,
  PackageOpen,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import NotificationBell from "./NotificationBell";

const MIN_SIDEBAR_WIDTH = 208;
const DEFAULT_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 480;

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
  { to: "/cycle-counts", icon: ClipboardList, label: "Cycle Counts", perm: "cycle_counts.view" },
  { to: "/boms", icon: Factory, label: "BOMs", perm: "bom.view" },
  { to: "/work-orders", icon: Workflow, label: "Work Orders", perm: "work_orders.view" },
  { to: "/planning", icon: Sparkles, label: "Planning", perm: "planning.view" },
  { to: "/shipments", icon: PackageOpen, label: "Shipments", perm: "shipments.view" },
  { to: "/quality-checks", icon: FlaskConical, label: "Quality", perm: "quality_checks.view" },
  { to: "/stock-movements", icon: ArrowLeftRight, label: "Movements", perm: "stock.view" },
  { to: "/exceptions", icon: AlertTriangle, label: "Exceptions", perm: "reports.view" },
  { to: "/users", icon: UsersIcon, label: "Users", perm: "users.view" },
  { to: "/reports", icon: BarChart3, label: "Reports", perm: "reports.view" },
  { to: "/activity-log", icon: History, label: "Activity", perm: "activity.view" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", perm: "settings.view" },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH ? saved : DEFAULT_SIDEBAR_WIDTH;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user, can } = useAuth();
  const { theme, setTheme } = useTheme();
  const visibleNavItems = navItems.filter((item) => can(item.perm));

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
        style={{ width: sidebarWidth }}
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar max-w-[85vw] transform transition-transform lg:translate-x-0 lg:static lg:inset-auto lg:max-w-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
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
        <div className="shrink-0 border-t border-gray-800 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-faint truncate">{user?.username}</div>
            <button onClick={handleLogout} className="p-2 text-faint hover:text-white">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startResize}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/70 active:bg-indigo-500 hidden lg:block"
        />
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="text-muted lg:hidden">
            <Menu size={24} />
          </button>
          <div className="hidden lg:block text-lg font-semibold text-ink">Inventura Storage</div>
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
            <span className="text-sm text-muted hidden sm:block">{user?.username}</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
