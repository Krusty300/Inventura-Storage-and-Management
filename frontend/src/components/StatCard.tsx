import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export type StatCardTone = "primary" | "amber" | "emerald" | "sky" | "violet" | "red" | "default";

const TONE_CLASSES: Record<StatCardTone, string> = {
  primary: "bg-primary-soft text-primary-strong dark:text-primary",
  amber: "bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  sky: "bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400",
  red: "bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400",
  default: "bg-subtle text-muted",
};

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: StatCardTone;
  /** Optional route to link the whole card to. */
  to?: string;
  onClick?: () => void;
}

const INTERACTIVE_CLASSES =
  "transition-colors hover:border-primary/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

function StatCardContent({ label, value, icon: Icon, tone = "default" }: Pick<StatCardProps, "label" | "value" | "icon" | "tone">) {
  return (
    <>
      {Icon && (
        <span
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TONE_CLASSES[tone]}`}
          aria-hidden="true"
        >
          <Icon size={20} strokeWidth={2} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="text-2xl font-bold text-ink truncate">{value}</p>
      </div>
    </>
  );
}

export default function StatCard({ label, value, icon, tone, to, onClick }: StatCardProps) {
  const base = "card p-5 flex items-center gap-4 w-full";
  if (to) {
    return (
      <Link to={to} className={`${base} ${INTERACTIVE_CLASSES}`}>
        <StatCardContent label={label} value={value} icon={icon} tone={tone} />
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${INTERACTIVE_CLASSES} text-left`}>
        <StatCardContent label={label} value={value} icon={icon} tone={tone} />
      </button>
    );
  }
  return (
    <div className={base}>
      <StatCardContent label={label} value={value} icon={icon} tone={tone} />
    </div>
  );
}

interface KpiGridProps {
  /** Target column count on large screens (responsive grid underneath). */
  columns?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}

const GRID_COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function KpiGrid({ columns = 4, className = "", children }: KpiGridProps) {
  return <div className={`grid grid-cols-1 gap-3 ${GRID_COLS[columns]} ${className}`}>{children}</div>;
}