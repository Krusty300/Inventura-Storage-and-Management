import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "recent_searches_";
const MAX_RECENT = 8;

function readRecents(scope: string): string[] {
  const key = `${STORAGE_PREFIX}${scope}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export interface UseRecentSearches {
  recent: string[];
  addRecent: (term: string) => void;
  clearRecent: () => void;
}

/** Persists the most recent search terms per scope (entity type, "global", ...)
 * to localStorage so the UI can offer quick recall and autocomplete. */
export function useRecentSearches(scope: string): UseRecentSearches {
  const [recent, setRecent] = useState<string[]>(() => readRecents(scope));

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${scope}`, JSON.stringify(recent));
    } catch {
      // localStorage unavailable (private mode) — best-effort only
    }
  }, [scope, recent]);

  const addRecent = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecent((prev) => [trimmed, ...prev.filter((x) => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT));
  }, []);

  const clearRecent = useCallback(() => setRecent([]), []);

  return { recent, addRecent, clearRecent };
}