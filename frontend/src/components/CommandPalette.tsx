import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  Boxes,
  ClipboardList,
  Contact,
  Factory,
  Fingerprint,
  FlaskConical,
  Layers,
  LayoutDashboard,
  MapPin,
  Monitor,
  Moon,
  Package,
  PackageCheck,
  PackageOpen,
  Receipt,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Store,
  Sun,
  Tags,
  Truck,
  Type,
  Users as UsersIcon,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import api from "../api/client";
import { navGroups } from "../utils/navItems";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useFontSize } from "../context/FontSizeContext";
import { useDebounce } from "../hooks/useDebounce";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import { useTrapFocus } from "../hooks/useTrapFocus";
import ScrollArea from "./ScrollArea";
import type { GlobalSearchResponse, GlobalSearchResult } from "../types";

const TYPE_LABELS: Record<string, string> = {
  product: "Products",
  lot: "Lots",
  serial: "Serial Numbers",
  lpn: "LPNs",
  location: "Locations",
  category: "Categories",
  customer: "Customers",
  supplier: "Suppliers",
  user: "Users",
  receipt: "Receipts",
  asn: "ASNs",
  order: "Orders",
  sale: "Sales",
  shipment: "Shipments",
  work_order: "Work Orders",
  cycle_count: "Cycle Counts",
  quality_check: "Quality Checks",
  bom: "Bills of Materials",
  sales_channel: "Sales Channels",
};

const RESULT_ICONS: Record<string, LucideIcon> = {
  product: Package,
  lot: Layers,
  serial: Fingerprint,
  lpn: Boxes,
  location: MapPin,
  category: Tags,
  customer: Contact,
  supplier: Truck,
  user: UsersIcon,
  receipt: PackageCheck,
  asn: Truck,
  order: ShoppingCart,
  sale: Receipt,
  shipment: PackageOpen,
  work_order: Workflow,
  cycle_count: ClipboardList,
  quality_check: FlaskConical,
  bom: Factory,
  sales_channel: Store,
};

const PORTAL_COMMANDS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/portal", label: "Overview", icon: LayoutDashboard },
  { to: "/portal/orders", label: "Purchase Orders", icon: ClipboardList },
  { to: "/portal/asns", label: "Shipments", icon: PackageCheck },
  { to: "/portal/receipts", label: "Deliveries", icon: PackageOpen },
  { to: "/portal/notifications", label: "Notifications", icon: Bell },
  { to: "/portal/settings", label: "Settings", icon: SettingsIcon },
];

interface Command {
  id: string;
  label: string;
  subtitle?: string;
  keywords?: string;
  section: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

type Row =
  | { kind: "header"; section: string }
  | { kind: "item"; command: Command; index: number };

export default function CommandPalette({ portal = false }: { portal?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { reset } = useFontSize();
  const debounced = useDebounce(query, 300);

  const close = () => setOpen(false);
  const openPalette = () => {
    setOpen(true);
    setQuery("");
    setActive(0);
  };

  useEffect(() => {
    const handler = () => openPalette();
    window.addEventListener("open-command-palette", handler);
    return () => window.removeEventListener("open-command-palette", handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setQuery("");
            setActive(0);
          }
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLockBodyScroll(open);
  useTrapFocus(paletteRef, open, close);

  const { data: searchData, isFetching: searchFetching } = useQuery({
    queryKey: ["command-search", debounced],
    queryFn: async () => (await api.get("/search", { params: { q: debounced } })).data as GlobalSearchResponse,
    enabled: !portal && open && debounced.trim().length >= 2,
  });

  const pageCommands = useMemo<Command[]>(() => {
    if (portal) {
      return PORTAL_COMMANDS.map((item) => ({
        id: `portal-${item.to}`,
        label: item.label,
        keywords: "portal supplier",
        section: "Portal",
        icon: item.icon,
        hint: item.to,
        run: () => navigate(item.to),
      }));
    }
    const out: Command[] = [];
    for (const group of navGroups) {
      if (group.roles && !group.roles.includes(user?.role ?? "")) continue;
      const items = group.items.filter((item) => can(item.perm));
      for (const item of items) {
        out.push({
          id: `nav-${item.to}`,
          label: item.label,
          keywords: group.label,
          section: group.label,
          icon: item.icon,
          hint: item.to,
          run: () => navigate(item.to),
        });
      }
    }
    return out;
  }, [can, navigate, portal, user?.role]);

  const actionCommands = useMemo<Command[]>(() => {
    const order = ["light", "system", "dark"] as const;
    const cycleTheme = () => setTheme(order[(order.indexOf(theme) + 1) % order.length]);
    const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
    return [
      {
        id: "theme",
        label: `Color theme: ${theme[0].toUpperCase()}${theme.slice(1)}`,
        keywords: "appearance dark light system mode switch",
        section: "Actions",
        icon: ThemeIcon,
        run: cycleTheme,
      },
      {
        id: "font-reset",
        label: "Reset font size to 100%",
        keywords: "text zoom accessibility scale",
        section: "Actions",
        icon: Type,
        run: () => reset(),
      },
    ];
  }, [theme, setTheme, reset]);

  const searchCommands = useMemo<Command[]>(() => {
    return (searchData?.results ?? []).map((r: GlobalSearchResult) => ({
      id: `search-${r.type}-${r.id}`,
      label: r.label,
      subtitle: r.subtitle,
      keywords: r.subtitle,
      section: TYPE_LABELS[r.type] ?? r.type,
      icon: RESULT_ICONS[r.type] ?? Search,
      hint: r.route,
      run: () => navigate(`${r.route}?search=${encodeURIComponent(r.label)}`),
    }));
  }, [searchData, navigate]);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: Command) =>
      !q || c.label.toLowerCase().includes(q) || (c.keywords ?? "").toLowerCase().includes(q);
    return [...actionCommands, ...pageCommands, ...(q ? searchCommands : [])].filter(matches);
  }, [query, actionCommands, pageCommands, searchCommands]);

  useEffect(() => {
    setActive(0);
  }, [open, query, commands.length]);

  useEffect(() => {
    if (!open) return;
    const row = paletteRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastSection: string | null = null;
    commands.forEach((c, i) => {
      if (c.section !== lastSection) {
        out.push({ kind: "header", section: c.section });
        lastSection = c.section;
      }
      out.push({ kind: "item", command: c, index: i });
    });
    return out;
  }, [commands]);

  const select = (cmd: Command) => {
    close();
    setQuery("");
    cmd.run();
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (commands.length) setActive((a) => (a + 1) % commands.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commands.length) setActive((a) => (a - 1 + commands.length) % commands.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = commands[active];
      if (cmd) select(cmd);
    }
  };

  const searching = !portal && query.trim().length >= 2;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150" onClick={close} />
      <div
        ref={paletteRef}
        className="relative w-full max-w-xl rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-150"
      >
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search size={18} className="text-faint shrink-0" />
          <input
            aria-label="Command search"
            className="command-palette-input w-full py-4 bg-transparent outline-none text-ink placeholder:text-faint text-base"
            placeholder="Search pages, actions, products, orders, customers..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <kbd className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded bg-subtle border border-border text-muted">esc</kbd>
        </div>

        <ScrollArea className="shrink-0" viewportClassName="max-h-[60vh] p-2 sa-viewport-contain">
          {searchFetching && searching && commands.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <div className="mx-auto h-4 w-4 rounded bg-subtle-strong animate-pulse" />
            </div>
          ) : commands.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <p className="text-sm font-medium text-ink">No matches</p>
              <p className="text-xs text-muted mt-1">Try a different search term or page name.</p>
            </div>
          ) : (
            rows.map((row) => {
              if (row.kind === "header") {
                return (
                  <div key={`h-${row.section}`} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
                    {row.section}
                  </div>
                );
              }
              const { command, index } = row;
              return (
                <button
                  key={command.id}
                  data-active={index === active || undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(command)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                    index === active ? "bg-primary-soft dark:bg-primary/10" : "hover:bg-subtle"
                  }`}
                >
                  <command.icon size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink truncate">{command.label}</span>
                    {command.subtitle && <span className="block text-xs text-muted truncate">{command.subtitle}</span>}
                  </span>
                  <span className="shrink-0 flex items-center gap-1.5">
                    {command.hint && <span className="text-[11px] text-faint hidden sm:block">{command.hint}</span>}
                    <ArrowRight size={14} className="text-faint" />
                  </span>
                </button>
              );
            })
          )}
        </ScrollArea>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-faint">
          <span>
            <kbd className="font-mono">&#8593;</kbd> <kbd className="font-mono">&#8595;</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">&#8629;</kbd> open
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}