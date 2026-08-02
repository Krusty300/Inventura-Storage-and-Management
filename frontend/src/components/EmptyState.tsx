import { PackageOpen, Plus } from "lucide-react";

interface Props {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export default function EmptyState({
  title = "No data found",
  message = "Get started by creating your first entry.",
  actionLabel,
  onAction,
  icon,
}: Props) {
  return (
    <tr>
      <td colSpan={99} className="px-4 py-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="text-gray-300 mb-3">
            {icon || <PackageOpen size={48} />}
          </div>
          <h3 className="text-lg font-medium text-gray-600 mb-1">{title}</h3>
          <p className="text-sm text-gray-400 mb-4 max-w-xs">{message}</p>
          {actionLabel && onAction && (
            <button onClick={onAction} className="btn-primary text-sm flex items-center gap-1.5">
              <Plus size={16} />
              {actionLabel}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
