import { memo } from "react";

interface Props {
  variant?: "table" | "card" | "text" | "rows";
  rows?: number;
  cols?: number;
  className?: string;
}

function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 bg-subtle-strong rounded animate-pulse" style={{ width: c === cols - 1 ? "60%" : "80%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <div className="h-4 w-24 bg-subtle-strong rounded animate-pulse mb-3" />
          <div className="h-8 w-16 bg-subtle-strong rounded animate-pulse" />
        </div>
      ))}
    </>
  );
}

function RowsSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden p-0">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3 border-b border-border">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-4 bg-subtle-strong rounded animate-pulse" style={{ flex: 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

const Skeleton = memo(function Skeleton({ variant = "table", rows, cols, className = "" }: Props) {
  if (variant === "card") return <CardSkeleton count={rows} />;
  if (variant === "rows") return <RowsSkeleton rows={rows} cols={cols} />;
  if (variant === "table") return <TableSkeleton rows={rows} cols={cols} />;
  return <div className={`h-4 bg-subtle-strong rounded animate-pulse ${className}`} />;
});

export default Skeleton;
