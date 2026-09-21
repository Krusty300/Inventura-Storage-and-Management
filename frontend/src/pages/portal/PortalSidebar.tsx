import { useRef } from "react";
import { Link } from "react-router-dom";
import { LogOut, X } from "lucide-react";
import type { PortalNavItem } from "../../portalNav";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useLockBodyScroll } from "../../hooks/useLockBodyScroll";
import { useTrapFocus } from "../../hooks/useTrapFocus";

const DESKTOP_MQ = "(min-width: 768px)";

interface PortalSidebarProps {
  items: PortalNavItem[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  storeName?: string;
  username?: string;
  logoUrl?: string;
}

export default function PortalSidebar({
  items,
  activeId,
  open,
  onClose,
  onLogout,
  storeName,
  username,
  logoUrl,
}: PortalSidebarProps) {
  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const asideRef = useRef<HTMLElement>(null);
  const mobileOpen = open && !isDesktop;

  useLockBodyScroll(mobileOpen);
  useTrapFocus(asideRef, mobileOpen, onClose);

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={asideRef}
        aria-label="Portal navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 max-w-[85vw] flex-col border-r border-border bg-sidebar transition-transform duration-200 md:sticky md:top-[3.75rem] md:z-auto md:max-w-none md:self-start md:h-[calc(100vh-3.75rem)] md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${!mobileOpen && !isDesktop ? "invisible md:visible" : ""}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2 md:hidden">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={logoUrl || getPlaceholder()}
              onError={onImageError}
              alt={storeName ?? "Portal"}
              className="h-9 w-9 rounded-xl object-cover shrink-0"
            />
            <span className="min-w-0 text-sm font-bold text-ink truncate">{storeName || username || "Portal"}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1 text-faint hover:text-ink rounded-lg"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <nav className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeId;
              return (
                <Link
                  key={item.id}
                  to={item.id}
                  className={`sidebar-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onClose}
                >
                  <Icon size={20} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-sm text-muted truncate" title={storeName || username}>
              {storeName || username}
            </span>
            <button
              onClick={onLogout}
              className="p-2 shrink-0 text-faint hover:text-ink rounded-lg"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}