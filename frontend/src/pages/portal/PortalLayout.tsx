import { useCallback, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, LayoutDashboard, ClipboardList, PackageCheck, PackageOpen, Bell, Search, Settings as SettingsIcon } from "lucide-react";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { entityImageUrl } from "../../utils/images";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import NotificationBell from "../../components/NotificationBell";
import CommandPalette from "../../components/CommandPalette";
import ExpandableTabs, { type ExpandableTabsTab } from "../../components/ExpandableTabs";
import type { PortalMe } from "../../types";

const PORTAL_NAV_TABS: ExpandableTabsTab<string>[] = [
  { id: "/portal", label: "Overview", icon: LayoutDashboard },
  { id: "/portal/orders", label: "Purchase Orders", icon: ClipboardList },
  { id: "/portal/asns", label: "Shipments", icon: PackageCheck },
  { id: "/portal/receipts", label: "Deliveries", icon: PackageOpen },
  { id: "/portal/notifications", label: "Notifications", icon: Bell },
  { id: "/portal/settings", label: "Settings", icon: SettingsIcon },
];

export default function PortalLayout() {
  const { user, logout, completeLogout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: me } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });

  const handleLogout = useCallback(() => {
    setLoggingOut(true);
    logout();
    setTimeout(() => completeLogout(), 600);
  }, [logout, completeLogout]);

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
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
              aria-label="Open command palette"
              title="Command palette (Ctrl+K)"
              className="p-2 text-faint hover:text-ink rounded-lg"
            >
              <Search size={18} />
            </button>
            <NotificationBell />
            <span className="hidden sm:inline-flex badge badge-info">Supplier</span>
            <button onClick={handleLogout} className="p-2 text-faint hover:text-ink rounded-lg" title="Log out" aria-label="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <ExpandableTabs
        value={pathname}
        onChange={(to) => navigate(to)}
        tabs={PORTAL_NAV_TABS}
        ariaLabel="Portal navigation"
        position="top"
        matchByPrefix
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6"
      >
        <Outlet />
      </ExpandableTabs>

      {loggingOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-6 py-3 rounded-xl bg-surface border border-border shadow-lg">
            <div className="h-4 w-4 rounded bg-subtle-strong animate-pulse" />
            <span className="text-sm font-medium text-ink">Signing out</span>
          </div>
        </div>
      )}

      <CommandPalette portal />
    </div>
  );
}