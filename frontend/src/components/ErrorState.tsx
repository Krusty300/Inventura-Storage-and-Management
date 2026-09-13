import { memo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
  variant?: "table" | "block";
}

const ErrorState = memo(function ErrorState({
  title = "Failed to load data",
  message = "Something went wrong while fetching this data. Please try again.",
  onRetry,
  variant = "table",
}: Props) {
  const content = (
    <div className="flex flex-col items-center justify-center text-center">
      <div className="text-red-500 mb-3">
        <AlertTriangle size={48} />
      </div>
      <h3 className="text-lg font-medium text-muted mb-1">{title}</h3>
      <p className="text-sm text-faint mb-4 max-w-xs">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw size={16} />
          Retry
        </button>
      )}
    </div>
  );

  if (variant === "block") {
    return <div className="card flex flex-col items-center justify-center text-center px-4 py-12">{content}</div>;
  }

  return (
    <tr>
      <td colSpan={99} className="px-4 py-12">
        {content}
      </td>
    </tr>
  );
});

export default ErrorState;
