import type { StockLocationSummary } from "../hooks/useProductStockLocations";

interface Props {
  locations: StockLocationSummary[];
  isSerialized: boolean;
  selectedPath: string;
  onSelect: (path: string) => void;
  isLoading?: boolean;
}

export default function StockLocationHints({ locations, isSerialized, selectedPath, onSelect, isLoading }: Props) {
  if (isLoading || locations.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="text-xs text-muted mb-1">
        {isSerialized ? "In-stock serials are located at:" : "Stock is currently at:"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {locations.map((l) => (
          <button
            key={l.location_id}
            type="button"
            onClick={() => onSelect(l.path)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              selectedPath === l.path
                ? "border-indigo-400 text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-500/10"
                : "border-border-strong bg-subtle text-muted hover:text-indigo-600 dark:hover:text-indigo-400"
            }`}
          >
            {l.path} ({l.count})
          </button>
        ))}
      </div>
    </div>
  );
}
