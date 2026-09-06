import { useCallback, useEffect, useRef, useState } from "react";
import type { SaleDraftLineItem } from "./useSaleDraft";
import { clearSaleDraft, hasSaleDraft, loadSaleDraft } from "./useSaleDraft";

const STORAGE_KEY = "multiCartV1";

/**
 * A single cart's full draft state (mirrors the legacy SaleDraftData fields
 * that the sale form edits, plus a savedAt timestamp). Carts are entirely a
 * frontend concern — nothing about them is persisted server-side, just like
 * the legacy single-cart draft.
 */
export interface MultiCartDraft {
  customerId: string;
  channelId: string;
  paymentMethod: string;
  paymentProvider: string;
  paymentPhone: string;
  paymentReference: string;
  paymentProviderAmount: string;
  notes: string;
  discount: string;
  promoCode: string;
  promoDiscount: number;
  amountReceived: string;
  items: SaleDraftLineItem[];
  savedAt: string;
}

export type MultiCartDraftInput = Omit<MultiCartDraft, "savedAt">;

export interface MultiCart {
  id: string;
  name: string;
  createdAt: string;
  draft: MultiCartDraft | null;
}

interface MultiCartState {
  carts: MultiCart[];
  activeId: string;
}

let idCounter = 0;

function makeId(): string {
  idCounter += 1;
  return `cart-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCart(name: string): MultiCart {
  return { id: makeId(), name, createdAt: new Date().toISOString(), draft: null };
}

function freshState(): MultiCartState {
  const cart = makeCart("Cart 1");
  return { carts: [cart], activeId: cart.id };
}

function sanitizeLineItems(items: unknown): SaleDraftLineItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const it = raw as Partial<SaleDraftLineItem>;
    if (typeof it.product_id !== "string" || typeof it.quantity !== "string") return [];
    return [{
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: typeof it.unit_price === "string" ? it.unit_price : "0",
      location_id: typeof it.location_id === "string" ? it.location_id : "",
    }];
  });
}

/** Coerce a persisted draft into a well-formed value, or null when unusable. */
function sanitizeDraft(draft: unknown): MultiCartDraft | null {
  if (!draft || typeof draft !== "object") return null;
  const d = draft as Partial<MultiCartDraft>;
  const items = sanitizeLineItems(d.items);
  if (items.length === 0) return null;
  return {
    customerId: typeof d.customerId === "string" ? d.customerId : "",
    channelId: typeof d.channelId === "string" ? d.channelId : "",
    paymentMethod: typeof d.paymentMethod === "string" ? d.paymentMethod : "cash",
    paymentProvider: typeof d.paymentProvider === "string" ? d.paymentProvider : "",
    paymentPhone: typeof d.paymentPhone === "string" ? d.paymentPhone : "",
    paymentReference: typeof d.paymentReference === "string" ? d.paymentReference : "",
    paymentProviderAmount: typeof d.paymentProviderAmount === "string" ? d.paymentProviderAmount : "",
    notes: typeof d.notes === "string" ? d.notes : "",
    discount: typeof d.discount === "string" ? d.discount : "",
    promoCode: typeof d.promoCode === "string" ? d.promoCode : "",
    promoDiscount: typeof d.promoDiscount === "number" && Number.isFinite(d.promoDiscount) ? d.promoDiscount : 0,
    amountReceived: typeof d.amountReceived === "string" ? d.amountReceived : "",
    items,
    savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date().toISOString(),
  };
}

function loadStorage(): MultiCartState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultiCartState;
    if (!parsed || !Array.isArray(parsed.carts)) return null;
    const carts: MultiCart[] = [];
    for (const rawCart of parsed.carts) {
      if (!rawCart || typeof rawCart !== "object") continue;
      const c = rawCart as Partial<MultiCart>;
      if (typeof c.id !== "string" || !c.id) continue;
      carts.push({
        id: c.id,
        name: typeof c.name === "string" ? c.name : c.id,
        createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date().toISOString(),
        draft: sanitizeDraft(c.draft),
      });
    }
    if (carts.length === 0) return null;
    // An activeId that points at a missing cart falls back to the first cart.
    const activeId = typeof parsed.activeId === "string" && carts.some((c) => c.id === parsed.activeId)
      ? parsed.activeId
      : carts[0].id;
    return { carts, activeId };
  } catch {
    return null;
  }
}

function persist(state: MultiCartState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded etc — silently ignore */
  }
}

/** Migrate a legacy single-cart `saleDraft` into the multi-cart format. */
function legacyState(): MultiCartState | null {
  const legacy = loadSaleDraft();
  if (!legacy) return null;
  const cart: MultiCart = {
    id: makeId(),
    name: "Cart 1",
    createdAt: legacy.savedAt,
    draft: {
      ...legacy,
      promoCode: "",
      promoDiscount: 0,
      savedAt: legacy.savedAt,
    },
  };
  return { carts: [cart], activeId: cart.id };
}

function defaultState(): MultiCartState {
  const stored = loadStorage();
  if (stored) return stored;
  const legacy = legacyState();
  if (legacy) {
    // Once migrated we never want to re-trigger the legacy path.
    clearSaleDraft();
    return legacy;
  }
  return freshState();
}

/** True when there is saved draft content worth protecting behind the lock screen. */
export function hasPersistedCarts(): boolean {
  if (hasSaleDraft()) return true;
  const state = loadStorage();
  return !!state && state.carts.some((c) => c.draft !== null);
}

/** savedAt of the most recent saved draft (used for the lock screen timestamp). */
export function getPersistedSavedAt(): string | null {
  const state = loadStorage();
  if (state) return state.carts.find((c) => c.draft)?.draft?.savedAt ?? null;
  return loadSaleDraft()?.savedAt ?? null;
}

/**
 * Owns all open carts and persists them under `multiCartV1` in localStorage.
 * When `enabled` is false (form locked, or a saved draft awaiting restore) the
 * hook reads from an in-memory empty state so the persisted carts are never
 * overwritten by the temporary locked view.
 */
export function useMultiCart(enabled: boolean) {
  const [state, setState] = useState<MultiCartState>(() =>
    enabled ? defaultState() : freshState(),
  );

  // True once we've ever rendered with persistence on. When the form is later
  // locked (enabled → false) the hook keeps the real carts in memory, so we
  // flush that final state to storage on the flip; otherwise the lock would
  // drop the last debounced save. A mount that starts locked never writes.
  const hadEnabled = useRef(false);

  useEffect(() => {
    if (enabled) {
      hadEnabled.current = true;
      persist(state);
    } else if (hadEnabled.current) {
      persist(state);
      hadEnabled.current = false;
    }
  }, [state, enabled]);

  const activeCart: MultiCart =
    state.carts.find((c) => c.id === state.activeId) ?? state.carts[0];

  const createCart = useCallback(() => {
    setState((prev) => {
      const maxNum = prev.carts.reduce((max, c) => {
        const m = /^Cart (\d+)$/.exec(c.name);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      const cart = makeCart(`Cart ${maxNum + 1}`);
      return { carts: [...prev.carts, cart], activeId: cart.id };
    });
  }, []);

  const switchCart = useCallback((id: string) => {
    setState((prev) =>
      prev.carts.some((c) => c.id === id) ? { ...prev, activeId: id } : prev,
    );
  }, []);

  const deleteCart = useCallback((id: string) => {
    setState((prev) => {
      const remaining = prev.carts.filter((c) => c.id !== id);
      if (remaining.length === 0) return freshState();
      return {
        carts: remaining,
        activeId: prev.activeId === id ? remaining[0].id : prev.activeId,
      };
    });
  }, []);

  const renameCart = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      carts: prev.carts.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  }, []);

  const updateCart = useCallback((id: string, draft: MultiCartDraft | null) => {
    setState((prev) => ({
      ...prev,
      carts: prev.carts.map((c) => (c.id === id ? { ...c, draft } : c)),
    }));
  }, []);

  const updateActiveCart = useCallback((draft: MultiCartDraft | null) => {
    setState((prev) => ({
      ...prev,
      carts: prev.carts.map((c) => (c.id === prev.activeId ? { ...c, draft } : c)),
    }));
  }, []);

  const clearActiveCart = useCallback(() => {
    updateActiveCart(null);
  }, [updateActiveCart]);

  /** Reload carts from storage (called after the lock screen is unlocked). */
  const restoreCarts = useCallback(() => {
    setState(defaultState());
  }, []);

  /** Wipe all persisted carts and start fresh with one empty cart. */
  const discardPersisted = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    clearSaleDraft();
    setState(freshState());
  }, []);

  return {
    carts: state.carts,
    activeCart,
    activeCartId: activeCart.id,
    createCart,
    switchCart,
    deleteCart,
    renameCart,
    updateCart,
    updateActiveCart,
    clearActiveCart,
    restoreCarts,
    discardPersisted,
  };
}

/**
 * Debounced autosave helper. `scheduleSave` waits 400ms before writing the
 * latest draft; `flushSave` cancels any pending write and commits immediately
 * (used when switching/deleting carts so edits never land in the wrong cart).
 * The latest getter/saver are kept in refs so the callbacks stay stable.
 */
export function useDebouncedAutosave(
  getState: () => MultiCartDraftInput | null,
  enabled: boolean,
  save: (draft: MultiCartDraftInput) => void,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getStateRef = useRef(getState);
  const saveRef = useRef(save);

  useEffect(() => {
    getStateRef.current = getState;
    saveRef.current = save;
  });

  const run = useCallback(() => {
    const draft = getStateRef.current();
    if (draft) saveRef.current(draft);
  }, []);

  const scheduleSave = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, 400);
  }, [enabled, run]);

  const flushSave = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!enabled) return;
    run();
  }, [enabled, run]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { scheduleSave, flushSave };
}