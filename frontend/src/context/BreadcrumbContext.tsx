import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

export interface CrumbEntry {
  id: string;
  label: string;
}

interface BreadcrumbContextValue {
  crumbs: CrumbEntry[];
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  crumbs: [],
  register: () => {},
  unregister: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<CrumbEntry[]>([]);

  const register = useCallback((id: string, label: string) => {
    setCrumbs((prev) => {
      const rest = prev.filter((c) => c.id !== id);
      return [...rest, { id, label }];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setCrumbs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = useMemo(() => ({ crumbs, register, unregister }), [crumbs, register, unregister]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBreadcrumbs() {
  return useContext(BreadcrumbContext);
}

/** Registers a contextual crumb (e.g. the open entity) while the caller is mounted and enabled. */
// eslint-disable-next-line react-refresh/only-export-components
export function useBreadcrumbExtension(label: string | null | undefined, enabled = true) {
  const { register, unregister } = useBreadcrumbs();
  const id = useId();

  useEffect(() => {
    if (!enabled || !label) return;
    register(id, label);
    return () => unregister(id);
  }, [id, label, enabled, register, unregister]);
}