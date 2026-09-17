import { useCallback, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, LayoutDashboard, ClipboardList, PackageCheck, PackageOpen, Bell, Settings as SettingsIcon } from "lucide-react";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { entityImageUrl } from "../../utils/images";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import NotificationBell from "../../components/NotificationBell";
import type { PortalMe } from "../../types";

export default function PortalLayout() {
  const { user, logout, completeLogout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });

  const handleLogout = useCallback(() => {
    setLoggingOut(true);
    logout();
    setTimeout(() => completeLogout(), 600);
  }, [logout, completeLogout]);

  const navLink = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? "bg-primary-soft dark:bg-primary/15 text-primary-strong dark:text-primary" : "text-muted hover:text-ink hover:bg-subtle"
    }`;

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <header className="bg-surface border-b border-border sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={me?.logo_url || getPlaceholder()}
              onError={onImageError}
              alt={me?.store_name ?? "Supplier Portal"}
              className="h-9 w-9 rounded-xl object-cover shrink-0"
            />
            <div className="min-w-0">
              <p className="font-bold text-ink leading-tight truncate">{me?.store_name ?? "Supplier Portal"}</p>
              <div className="flex items-center gap-1.5 min-w-0">
                {me?.supplier.image_url && (
                  <img src={entityImageUrl(me.supplier.image_url)} alt={me.supplier.name} onError={onImageError} className="h-3 w-3 rounded-full object-cover shrink-0" />
                )}
                <p className="text-xs text-muted truncate">{me?.supplier.name ?? user?.username}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <NotificationBell />
            <span className="hidden sm:inline-flex badge badge-info">Supplier</span>
            <button onClick={handleLogout} className="p-2 text-faint hover:text-ink rounded-lg" title="Log out" aria-label="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 pb-3 flex items-center gap-1" aria-label="Portal navigation">
          <NavLink to="/portal" end className={navLink}>
            <LayoutDashboard size={16} /> Overview
          </NavLink>
          <NavLink to="/portal/orders" className={navLink}>
            <ClipboardList size={16} /> Purchase Orders
          </NavLink>
          <NavLink to="/portal/asns" className={navLink}>
            <PackageCheck size={16} /> Shipments
          </NavLink>
          <NavLink to="/portal/receipts" className={navLink}>
            <PackageOpen size={16} /> Deliveries
          </NavLink>
          <NavLink to="/portal/notifications" className={navLink}>
            <Bell size={16} /> Notifications
          </NavLink>
          <NavLink to="/portal/settings" className={navLink}>
            <SettingsIcon size={16} /> Settings
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>

      {loggingOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-6 py-3 rounded-xl bg-surface border border-border shadow-lg">
            <div className="h-4 w-4 rounded bg-subtle-strong animate-pulse" />
            <span className="text-sm font-medium text-ink">Signing out</span>
          </div>
        </div>
      )}
    </div>
  );
}