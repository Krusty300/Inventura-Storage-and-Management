import { useState } from "react";
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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";

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
  { to: "/stock-movements", icon: ArrowLeftRight, label: "Movements", perm: "stock.view" },
  { to: "/exceptions", icon: AlertTriangle, label: "Exceptions", perm: "reports.view" },
  { to: "/users", icon: UsersIcon, label: "Users", perm: "users.view" },
  { to: "/reports", icon: BarChart3, label: "Reports", perm: "reports.view" },
  { to: "/activity-log", icon: History, label: "Activity", perm: "activity.view" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", perm: "settings.view" },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user, can } = useAuth();
  const visibleNavItems = navItems.filter((item) => can(item.perm));

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-gray-900 transform transition-transform lg:translate-x-0 lg:static lg:inset-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="p-4 space-y-1">
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
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-400 truncate">{user?.username}</div>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-white">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-600 lg:hidden">
            <Menu size={24} />
          </button>
          <div className="hidden lg:block text-lg font-semibold text-gray-800">Inventura Storage</div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <span className="text-sm text-gray-500 hidden sm:block">{user?.username}</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
