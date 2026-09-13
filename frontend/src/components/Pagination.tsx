import { memo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FittedSelect from "./FittedSelect";

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  pageSize?: number;
  onPageSizeChange?: (n: number) => void;
}

const PAGE_SIZES = [10, 25, 50, 100];

function pageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "...")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("...");
    out.push(p);
    prev = p;
  }
  return out;
}

const Pagination = memo(function Pagination({ page, totalPages, onPageChange, pageSize, onPageSizeChange }: Props) {
  if (totalPages <= 1 && !onPageSizeChange) return null;
  const pages = pageWindow(page, totalPages);
  return (
    <div className="flex items-center justify-center gap-2 pt-4 pb-2 flex-wrap">
      {onPageSizeChange && (
        <label className="flex items-center gap-2 text-sm text-muted mr-4">
          Per page
          <FittedSelect
            value={String(pageSize)}
            onChange={(v) => onPageSizeChange(Number(v))}
            ariaLabel="Page size"
            maxWidth={80}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </label>
      )}
      {totalPages > 1 && (
        <>
          <button className="pagination-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          {pages.map((p, i) =>
            p === "..." ? (
              <span key={`e${i}`} className="px-1 text-faint" aria-hidden="true">…</span>
            ) : (
              <button key={p} className={`pagination-btn ${p === page ? "active" : ""}`} onClick={() => onPageChange(p)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}>
                {p}
              </button>
            )
          )}
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </>
      )}
    </div>
  );
});

export default Pagination;
