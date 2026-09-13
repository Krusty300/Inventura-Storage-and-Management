import { memo } from "react";
import { PackageOpen, Plus } from "lucide-react";

interface Props {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  variant?: "table" | "block";
  compact?: boolean;
}

const EmptyState = memo(function EmptyState({
  title = "No data found",
  message = "Get started by creating your first entry.",
  actionLabel,
  onAction,
  icon,
  variant = "table",
  compact = false,
}: Props) {
  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-4 py-8">
        <div className="text-faint mb-2">
          {icon || <PackageOpen size={20} />}
        </div>
        <h3 className="text-sm font-medium text-muted mb-0.5">{title}</h3>
        <p className="text-xs text-faint mb-3 max-w-xs">{message}</p>
        {actionLabel && onAction && (
          <button onClick={onAction} className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1">
            <Plus size={12} />
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  const content = (
    <>
      <div className="text-faint mb-3">
        {icon || <PackageOpen size={48} />}
      </div>
      <h3 className="text-lg font-medium text-muted mb-1">{title}</h3>
      <p className="text-sm text-faint mb-4 max-w-xs">{message}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={16} />
          {actionLabel}
        </button>
      )}
    </>
  );

  if (variant === "block") {
    return (
      <div className="card flex flex-col items-center justify-center text-center px-4 py-12">
        {content}
      </div>
    );
  }

  return (
    <tr>
      <td colSpan={99} className="px-4 py-12">
        <div className="flex flex-col items-center justify-center text-center">
          {content}
        </div>
      </td>
    </tr>
  );
});

export default EmptyState;