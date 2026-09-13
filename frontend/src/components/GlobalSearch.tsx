import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, Search } from "lucide-react";
import EmptyState from "./EmptyState";
import api from "../api/client";
import type { GlobalSearchResponse, GlobalSearchResult } from "../types";
import { useDebounce } from "../hooks/useDebounce";
import Skeleton from "./Skeleton";
import ScrollArea from "./ScrollArea";

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

interface Group {
  type: string;
  label: string;
  results: GlobalSearchResult[];
}

function groupResults(results: GlobalSearchResult[]): Group[] {
  const order = Object.keys(TYPE_LABELS);
  const map = new Map<string, GlobalSearchResult[]>();
  for (const r of results) {
    const list = map.get(r.type) || [];
    list.push(r);
    map.set(r.type, list);
  }
  const groups: Group[] = [];
  for (const t of order) {
    const list = map.get(t);
    if (list) groups.push({ type: t, label: TYPE_LABELS[t] ?? t, results: list });
  }
  return groups;
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounce(query, 300);
  const navigate = useNavigate();

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: async () => {
      const { data } = await api.get("/search", { params: { q: debounced } });
      return data as GlobalSearchResponse;
    },
    enabled: debounced.trim().length >= 2,
  });

  const results = useMemo(() => data?.results ?? [], [data]);
  const groups = useMemo(() => groupResults(results), [results]);
  const resultIndex = useMemo(() => new Map(results.map((r, i) => [r, i])), [results]);
  const searching = debounced.trim().length >= 2;
  const showPanel = open && searching;

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(results.length - 1, 0)));
  }, [results]);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('[aria-label="Global search"]');
        input?.focus();
      }, 50);
    };
    window.addEventListener("open-global-search", handler);
    return () => window.removeEventListener("open-global-search", handler);
  }, []);

  const select = (r: GlobalSearchResult) => {
    setOpen(false);
    setQuery("");
    navigate(`${r.route}?search=${encodeURIComponent(r.label)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showPanel || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) select(r);
    }
  };

  return (
    <div className="relative z-10">
      {showPanel && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      <div className="relative flex-1 max-w-2xl z-50">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          className="input pl-10 pr-10"
          placeholder="Search everything: products, lots, serials, documents, people..."
          value={query}
          aria-label="Global search"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={handleKeyDown}
        />
        {isFetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 rounded bg-subtle-strong animate-pulse" />
          </div>
        )}
      </div>

      {showPanel && (
        <ScrollArea className="absolute left-0 right-0 top-full mt-2 z-50 card p-0 overflow-hidden" viewportClassName="max-h-[70vh] sa-viewport-contain">
          {isFetching && results.length === 0 ? (
            <div className="divide-y divide-border" aria-busy="true" aria-label="Searching" role="status">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 space-y-1.5 flex-1">
                    <Skeleton variant="text" className="h-3.5 w-2/3" />
                    <Skeleton variant="text" className="h-3 w-1/3" />
                  </div>
                  <Skeleton variant="text" className="h-3.5 w-3.5 shrink-0" />
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState compact icon={<Search size={20} />} title={`No matches for "${debounced}"`} message="Try a different product, customer, or order number." />
          ) : (
            <div>
              {groups.map((g) => (
                <div key={g.type}>
                  <div className="bg-app px-4 py-1.5 text-xs font-semibold text-muted uppercase tracking-wide">
                    {g.label} ({g.results.length})
                  </div>
                  {g.results.map((r) => {
                    const idx = resultIndex.get(r) ?? 0;
                    return (
                      <button
                        key={`${r.type}-${r.id}`}
                        onClick={() => select(r)}
                        onMouseEnter={() => setActive(idx)}
                        className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${idx === active ? "bg-primary-soft dark:bg-primary/10" : "hover:bg-app"}`}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-ink truncate">{r.label}</span>
                          {r.subtitle && <span className="block text-xs text-muted truncate">{r.subtitle}</span>}
                        </span>
                        <span className="shrink-0 text-faint">
                          <CornerDownLeft size={14} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="border-t border-border px-4 py-2 text-xs text-faint">
                ↑↓ navigate · ↵ open · esc close
              </div>
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
