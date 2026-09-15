import { useCallback, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, LayoutDashboard, ClipboardList, Truck, PackageCheck, PackageOpen } from "lucide-react";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
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
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary-soft dark:bg-primary/20 text-primary-strong dark:text-primary shrink-0">
              <Truck size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-ink leading-tight truncate">{me?.store_name ?? "Supplier Portal"}</p>
              <p className="text-xs text-muted truncate">{me?.supplier.name ?? user?.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
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