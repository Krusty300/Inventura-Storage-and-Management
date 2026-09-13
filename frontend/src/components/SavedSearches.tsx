import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Check, X } from "lucide-react";

export interface SavedSearchEntry {
  id: string;
  name: string;
  params: Record<string, string>;
}

export interface SavedSearchesProps {
  /** localStorage key suffix that scopes saved searches to a page/entity. */
  scope: string;
  /** Human label used in the save button, e.g. "Products". */
  entityLabel: string;
  /** The page's current active filter params (URL-style keys + values). */
  currentParams: Record<string, string>;
  /** When true the save button is offered (e.g. only when filters are active). */
  active: boolean;
  /** Called with the param set of a clicked saved search so the page can restore it. */
  onApply: (params: Record<string, string>) => void;
  className?: string;
}

function readSaved(key: string): SavedSearchEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SavedSearchEntry =>
        !!e && typeof e === "object" && typeof e.name === "string" && !!e.params && typeof e.params === "object",
    );
  } catch {
    return [];
  }
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default function SavedSearches({
  scope,
  entityLabel,
  currentParams,
  active,
  onApply,
  className,
}: SavedSearchesProps) {
  const key = `saved_searches_${scope}`;
  const [entries, setEntries] = useState<SavedSearchEntry[]>(() => readSaved(key));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(entries));
    } catch {
      // best-effort persistence
    }
  }, [key, entries]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  const commitSave = () => {
    const entry: SavedSearchEntry = {
      id: makeId(),
      name: name.trim() || `${entityLabel} search ${entries.length + 1}`,
      params: { ...currentParams },
    };
    setEntries((prev) => [entry, ...prev]);
    setNaming(false);
    setName("");
  };

  const deleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`} data-testid="saved-searches">
      {active &&
        (naming ? (
          <span className="flex items-center gap-1.5">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSave();
                if (e.key === "Escape") setNaming(false);
              }}
              placeholder="Search name…"
              aria-label="Saved search name"
              className="input text-sm py-1 px-2 w-40"
            />
            <button type="button" onClick={commitSave} className="btn-primary inline-flex items-center gap-1 text-xs px-2 py-1" aria-label="Save search">
              <Check size={12} /> Save
            </button>
            <button type="button" onClick={() => setNaming(false)} className="btn-ghost inline-flex items-center gap-1 text-xs px-2 py-1" aria-label="Cancel">
              <X size={12} /> Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs px-2.5 py-1"
            aria-label={`Save this search`}
          >
            <BookmarkPlus size={14} /> Save Search
          </button>
        ))}
      {entries.map((e) => (
        <span key={e.id} className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-app px-2.5 py-1 text-xs">
          <button
            type="button"
            onClick={() => onApply(e.params)}
            className="inline-flex items-center gap-1 text-ink hover:text-primary"
            title={`Restore ${e.name}`}
          >
            <Bookmark size={12} className="text-primary" />
            {e.name}
          </button>
          <button
            type="button"
            onClick={() => deleteEntry(e.id)}
            className="text-faint hover:text-danger"
            aria-label={`Delete saved search ${e.name}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}