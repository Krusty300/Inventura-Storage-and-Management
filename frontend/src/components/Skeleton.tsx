interface Props {
  variant?: "table" | "card" | "text";
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
              <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: c === cols - 1 ? "60%" : "80%" }} />
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
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-3" />
          <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
        </div>
      ))}
    </>
  );
}

export default function Skeleton({ variant = "table", rows, cols, className = "" }: Props) {
  if (variant === "card") return <CardSkeleton count={rows} />;
  if (variant === "table") return <TableSkeleton rows={rows} cols={cols} />;
  return <div className={`h-4 bg-gray-200 rounded animate-pulse ${className}`} />;
}
