import { memo } from "react";

interface Props {
  value: number;
  max: number;
  label?: string;
  showPercent?: boolean;
  tone?: "success" | "warning" | "danger";
}

const ProgressBar = memo(function ProgressBar({ value, max, label, showPercent = true, tone }: Props) {
  const pct = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const toneClass = tone === "danger" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-primary" : "bg-amber-500";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block w-20 h-2 rounded-full bg-subtle overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <span className={`block h-full rounded-full ${toneClass}`} style={{ width: `${pct}%` }} />
      </span>
      {showPercent && <span className="text-xs text-muted tabular-nums">{Math.round(pct)}%</span>}
    </span>
  );
});

export default ProgressBar;
