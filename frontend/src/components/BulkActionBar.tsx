import { FileDown } from "lucide-react";

interface Props {
  count: number;
  onEdit: () => void;
  onClear: () => void;
  canEdit?: boolean;
  onPrintSelected?: () => void;
  printLoading?: boolean;
}

export default function BulkActionBar({ count, onEdit, onClear, canEdit = true, onPrintSelected, printLoading }: Props) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-primary-soft dark:bg-primary/10 rounded-lg border border-primary-soft dark:border-primary/30">
      <span className="text-sm font-medium text-primary-strong dark:text-primary">{count} selected</span>
      {canEdit && (
        <button onClick={onEdit} className="btn-primary text-sm px-3 py-1.5">
          Bulk Edit
        </button>
      )}
      {onPrintSelected && (
        <button onClick={onPrintSelected} disabled={printLoading} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1">
          <FileDown size={14} />{printLoading ? "Generating..." : "Print Selected"}
        </button>
      )}
      <button onClick={onClear} className="text-sm text-primary dark:text-primary hover:text-primary-strong dark:text-primary underline">
        Clear
      </button>
    </div>
  );
}
