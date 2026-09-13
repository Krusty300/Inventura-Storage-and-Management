import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { navGroups } from "../utils/navItems";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

interface TrailItem {
  label: string;
  to?: string;
}

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const { crumbs } = useBreadcrumbs();
  const topCrumb = crumbs[crumbs.length - 1];

  const group = navGroups.find((g) => g.items.some((item) => item.to === pathname));
  const item = group?.items.find((i) => i.to === pathname);

  const trail: TrailItem[] = [{ label: "Home", to: "/" }];
  if (item && item.to !== "/") {
    if (group && group.id !== "overview") trail.push({ label: group.label });
    trail.push({ label: item.label, to: item.to });
  }
  if (topCrumb) trail.push({ label: topCrumb.label });

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center flex-wrap gap-1.5 text-sm text-faint min-w-0">
      {trail.map((c, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={`${c.to || ""}-${c.label}-${i}`} className="inline-flex items-center gap-1.5 min-w-0">
            {i > 0 && <ChevronRight size={14} className="text-faint/70 shrink-0" aria-hidden="true" />}
            {isLast ? (
              <span className="font-medium text-ink truncate" aria-current="page">{c.label}</span>
            ) : c.to ? (
              <Link to={c.to} className="hover:text-ink transition-colors truncate">{c.label}</Link>
            ) : (
              <span className="truncate">{c.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}