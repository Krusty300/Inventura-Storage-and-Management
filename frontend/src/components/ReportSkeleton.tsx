interface SkeletonPulseProps {
  className?: string;
  style?: React.CSSProperties;
}

function P({ className = "", style }: SkeletonPulseProps) {
  return <div className={`bg-subtle-strong rounded animate-pulse ${className}`} style={style} />;
}

function StatCardSkeleton() {
  return (
    <div className="card space-y-2">
      <P className="h-3 w-20" />
      <P className="h-7 w-28" />
    </div>
  );
}

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div className="card">
      <P className="h-5 w-40 mb-4" />
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0 flex items-end gap-2 px-4 pb-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end gap-1">
              <P className="rounded-t" style={{ height: `${20 + Math.random() * 60}%` }} />
            </div>
          ))}
        </div>
        <div className="absolute bottom-0 inset-x-0 h-px bg-border" />
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="px-4 py-3 border-b border-border">
        <P className="h-5 w-48" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app">
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="px-4 py-3 text-left">
                  <P className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className="px-4 py-3">
                    <P className="h-4" style={{ width: `${50 + Math.random() * 40}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ReportSkeletonProps {
  stats?: number;
  chart?: boolean;
  chartHeight?: number;
  table?: boolean;
  tableCols?: number;
  tableRows?: number;
  twoCharts?: boolean;
}

export default function ReportSkeleton({
  stats = 3,
  chart = false,
  chartHeight = 300,
  table = false,
  tableCols = 5,
  tableRows = 5,
  twoCharts = false,
}: ReportSkeletonProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {stats > 0 && (
        <div className={`grid grid-cols-1 sm:grid-cols-${Math.min(stats, 4)} gap-4`}>
          {Array.from({ length: stats }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      )}
      {twoCharts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton height={chartHeight} />
          <ChartSkeleton height={chartHeight} />
        </div>
      )}
      {chart && !twoCharts && <ChartSkeleton height={chartHeight} />}
      {table && <TableSkeleton rows={tableRows} cols={tableCols} />}
    </div>
  );
}
