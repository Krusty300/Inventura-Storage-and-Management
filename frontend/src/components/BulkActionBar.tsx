interface Props {
  count: number;
  onEdit: () => void;
  onClear: () => void;
  canEdit?: boolean;
}

export default function BulkActionBar({ count, onEdit, onClear, canEdit = true }: Props) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg border border-indigo-200 dark:border-indigo-500/30">
      <span className="text-sm font-medium text-indigo-700 dark:text-indigo-400">{count} selected</span>
      {canEdit && (
        <button onClick={onEdit} className="btn-primary text-sm px-3 py-1.5">
          Bulk Edit
        </button>
      )}
      <button onClick={onClear} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400 underline">
        Clear
      </button>
    </div>
  );
}
