import { useCallback, useEffect, useRef } from "react";

const DRAFT_KEY = "saleDraft";
const CART_WIDTH_KEY = "saleDraft_cartWidth";

export interface SaleDraftLineItem {
  product_id: string;
  quantity: string;
  unit_price: string;
  location_id: string;
}

export interface SaleDraftData {
  customerId: string;
  paymentMethod: string;
  paymentProvider: string;
  paymentPhone: string;
  paymentReference: string;
  paymentProviderAmount: string;
  notes: string;
  discount: string;
  amountReceived: string;
  items: SaleDraftLineItem[];
  savedAt: string;
}

export function saveSaleDraft(draft: Omit<SaleDraftData, "savedAt">) {
  try {
    const data: SaleDraftData = { ...draft, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch { /* quota exceeded — silently ignore */ }
}

export function loadSaleDraft(): SaleDraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SaleDraftData;
  } catch {
    return null;
  }
}

export function clearSaleDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function loadCartWidth(): number | null {
  try {
    const raw = localStorage.getItem(CART_WIDTH_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 320 ? n : null;
  } catch {
    return null;
  }
}

export function saveCartWidth(width: number) {
  try {
    localStorage.setItem(CART_WIDTH_KEY, String(width));
  } catch { /* ignore */ }
}

export function hasSaleDraft(): boolean {
  return localStorage.getItem(DRAFT_KEY) !== null;
}

/**
 * Auto-saves SaleForm state to localStorage on every change.
 * Returns stable setter wrappers that trigger a debounced persist.
 */
export function useSaleDraftAutoSave(
  getState: () => Omit<SaleDraftData, "savedAt"> | null,
  enabled: boolean,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const state = getState();
      if (state) saveSaleDraft(state);
    }, 400);
  }, [enabled, getState]);

  useEffect(() => {
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  return scheduleSave;
}
