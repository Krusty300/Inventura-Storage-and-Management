import { useCallback, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, Search, ShoppingCart } from "lucide-react";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useCustomerCart } from "../../context/CustomerCartContext";
import { entityImageUrl } from "../../utils/images";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import NotificationBell from "../../components/NotificationBell";
import CommandPalette from "../../components/CommandPalette";
import PortalSidebar from "./PortalSidebar";
import { CUSTOMER_PORTAL_NAV, SUPPLIER_PORTAL_NAV } from "../../portalNav";
import type { CustomerPortalMe, PortalMe } from "../../types";

export default function PortalLayout() {
  const { user, logout, completeLogout } = useAuth();
  const isCustomer = user?.role === "customer";
  const { totalItems } = useCustomerCart();
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const { data: supplierMe } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
    enabled: !isCustomer,
  });
  const { data: customerMe } = useQuery({
    queryKey: ["customer", "me"],
    queryFn: async () => (await api.get("/customer/me")).data as CustomerPortalMe,
    enabled: isCustomer,
  });
  const me = (isCustomer ? customerMe : supplierMe) as CustomerPortalMe | PortalMe | undefined;

  const handleLogout = useCallback(() => {
    setLoggingOut(true);
    logout();
    setTimeout(() => completeLogout(), 600);
  }, [logout, completeLogout]);

  const tabs = isCustomer ? CUSTOMER_PORTAL_NAV : SUPPLIER_PORTAL_NAV;

  const activeId = useMemo(() => {
    let best: string | null = null;
    let bestLength = -1;
    for (const tab of tabs) {
      if (pathname === tab.id) return tab.id;
      if (pathname.startsWith(tab.id) && tab.id.length > bestLength) {
        bestLength = tab.id.length;
        best = tab.id;
      }
    }
    return best;
  }, [pathname, tabs]);

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <header className="bg-surface border-b border-border sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="-ml-1 p-1.5 text-muted hover:text-ink rounded-lg md:hidden"
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <img
              src={me?.logo_url || getPlaceholder()}
              onError={onImageError}
              alt={me?.store_name ?? "Portal"}
              className="h-9 w-9 rounded-xl object-cover shrink-0"
            />
            <div className="min-w-0">
              <p className="font-bold text-ink leading-tight truncate">{me?.store_name ?? "Supplier Portal"}</p>
              <div className="flex items-center gap-1.5 min-w-0">
                {isCustomer ? (
                  <>
                    {customerMe?.customer.image_url && (
                      <img src={entityImageUrl(customerMe.customer.image_url)} alt={customerMe.customer.name} onError={onImageError} className="h-3 w-3 rounded-full object-cover shrink-0" />
                    )}
                    <p className="text-xs text-muted truncate">{customerMe?.customer.name ?? user?.username}</p>
                  </>
                ) : (
                  <>
                    {supplierMe?.supplier.image_url && (
                      <img src={entityImageUrl(supplierMe.supplier.image_url)} alt={supplierMe.supplier.name} onError={onImageError} className="h-3 w-3 rounded-full object-cover shrink-0" />
                    )}
                    <p className="text-xs text-muted truncate">{supplierMe?.supplier.name ?? user?.username}</p>
                  </>
                )}
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
            {isCustomer && (
              <Link
                to="/portal/cart"
                aria-label={`Open cart with ${totalItems} item${totalItems === 1 ? "" : "s"}`}
                title="Cart"
                className="relative p-2 text-faint hover:text-ink rounded-lg"
              >
                <ShoppingCart size={18} />
                {totalItems > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary-solid text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {totalItems > 99 ? "99+" : totalItems}
                  </span>
                )}
              </Link>
            )}
            <NotificationBell />
            <span className="hidden sm:inline-flex badge badge-info">{isCustomer ? "Customer" : "Supplier"}</span>
            <button onClick={handleLogout} className="p-2 text-faint hover:text-ink rounded-lg" title="Log out" aria-label="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <PortalSidebar
          items={tabs}
          activeId={activeId}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onLogout={handleLogout}
          storeName={me?.store_name}
          username={user?.username}
          logoUrl={me?.logo_url}
        />
        <main className="flex-1 min-w-0">
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>

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