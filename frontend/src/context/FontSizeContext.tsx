import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const BASE_SIZE = 16;
const STORAGE_KEY = "inventura_font_scale";
const DEFAULT_SCALE = 1;

/* Step by 10% so the hit is perceptible. Index 3 is the default (100%). */
const SCALES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

interface FontSizeContextValue {
  scale: number;
  percent: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
}

const FontSizeContext = createContext<FontSizeContextValue | undefined>(undefined);

function readStoredScale(): number {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  return SCALES.includes(saved) ? saved : DEFAULT_SCALE;
}

function applyScale(scale: number) {
  document.documentElement.style.fontSize = `${BASE_SIZE * scale}px`;
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState<number>(() => {
    const stored = readStoredScale();
    applyScale(stored);
    return stored;
  });

  useEffect(() => {
    applyScale(scale);
  }, [scale]);

  const increase = useCallback(() => {
    setScale((current) => {
      const next = SCALES[SCALES.indexOf(current) + 1];
      if (next === undefined) return current;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const decrease = useCallback(() => {
    setScale((current) => {
      const next = SCALES[SCALES.indexOf(current) - 1];
      if (next === undefined) return current;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setScale(DEFAULT_SCALE);
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_SCALE));
  }, []);

  const value = useMemo<FontSizeContextValue>(
    () => ({
      scale,
      percent: Math.round(scale * 100),
      increase,
      decrease,
      reset,
      canIncrease: SCALES.indexOf(scale) < SCALES.length - 1,
      canDecrease: SCALES.indexOf(scale) > 0,
    }),
    [scale, increase, decrease, reset],
  );

  return (
    <FontSizeContext.Provider value={value}>
      {children}
    </FontSizeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFontSize() {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error("useFontSize must be used within FontSizeProvider");
  return ctx;
}