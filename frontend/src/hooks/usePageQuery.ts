import { useCallback, useMemo, useState } from "react";
import { useDebounce } from "./useDebounce";
import { usePageSize } from "./usePageSize";

export interface UsePageQueryOptions {
  /** Initial search string; falls back to a URL query param when undefined. */
  initialSearch?: string;
  /** URL query param that seeds the initial search (default "search"). */
  searchParam?: string;
  /** Debounce delay in ms for the search value (default 300). */
  debounceMs?: number;
}

export interface UsePageQueryResult<T extends Record<string, string>> {
  search: string;
  /** Updates search and resets to page 1. */
  setSearch: (value: string) => void;
  /** The search value after debounce; safe for query keys. */
  debouncedSearch: string;
  filters: T;
  /** Sets a filter by key (or search when key === "search") and resets to page 1. */
  setFilter: (key: string, value: string) => void;
  /** Clears a filter by key and resets to page 1. */
  clearFilter: (key: string) => void;
  /** Clears search + filters and resets to page 1. */
  reset: () => void;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  /** URL-style params ready to pass to api calls (skip/limit/search/filters). */
  params: Record<string, string>;
  /** Flat dependency list for React Query keys: search, page, pageSize, filter values. */
  deps: (string | number)[];
}

/**
 * Centralizes the list-page state every index page repeats:
 * search (URL-seeded + debounced), filter map, page/pageSize, and
 * derived query params + dependency arrays for useQuery keys.
 */
export function usePageQuery<T extends Record<string, string>>(
  initialFilters: T = {} as T,
  options: UsePageQueryOptions = {},
): UsePageQueryResult<T> {
  const { initialSearch, searchParam = "search", debounceMs = 300 } = options;

  const [search, setSearchState] = useState(
    () => initialSearch ?? new URLSearchParams(window.location.search).get(searchParam) ?? "",
  );
  const [filters, setFilters] = useState<T>(initialFilters);
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const debouncedSearch = useDebounce(search, debounceMs);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const setFilter = useCallback(
    (key: string, value: string) => {
      if (key === "search") {
        setSearchState(value);
        setPage(1);
        return;
      }
      setFilters((prev) => {
        if (prev[key] === value) return prev;
        return { ...prev, [key]: value };
      });
      setPage(1);
    },
    [],
  );

  const clearFilter = useCallback((key: string) => {
    setFilters((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setSearchState("");
    setFilters(initialFilters);
    setPage(1);
  }, [initialFilters]);

  const params = useMemo(() => {
    const out: Record<string, string> = {
      skip: String((page - 1) * pageSize),
      limit: String(pageSize),
    };
    const debounced = debouncedSearch.trim();
    if (debounced) out.search = debounced;
    for (const [key, value] of Object.entries(filters)) {
      if (value) out[key] = value;
    }
    return out;
  }, [page, pageSize, debouncedSearch, filters]);

  const deps = useMemo(
    () => [debouncedSearch, page, pageSize, ...Object.values(filters)],
    [debouncedSearch, page, pageSize, filters],
  );

  return {
    search,
    setSearch,
    debouncedSearch,
    filters,
    setFilter,
    clearFilter,
    reset,
    page,
    setPage,
    pageSize,
    setPageSize,
    params,
    deps,
  };
}