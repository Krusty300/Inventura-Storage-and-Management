import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CatalogProduct } from "../types";

export interface CartItem {
  product: CatalogProduct;
  quantity: number;
}

interface CustomerCartContextType {
  items: CartItem[];
  totalItems: number;
  add: (product: CatalogProduct, quantity?: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
}

const CustomerCartContext = createContext<CustomerCartContextType | null>(null);

const STORAGE_KEY = "customer_cart_v1";

export function CustomerCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CartItem[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (it) => it && it.product && typeof it.product.id === "number" && typeof it.quantity === "number" && it.quantity > 0,
      );
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full or unavailable - cart stays in memory */
    }
  }, [items]);

  const value = useMemo<CustomerCartContextType>(() => {
    const add: CustomerCartContextType["add"] = (product, quantity = 1) => {
      setItems((prev) => {
        const existing = prev.find((it) => it.product.id === product.id);
        if (existing) {
          return prev.map((it) =>
            it.product.id === product.id ? { ...it, quantity: it.quantity + quantity } : it,
          );
        }
        return [...prev, { product, quantity }];
      });
    };
    const setQuantity: CustomerCartContextType["setQuantity"] = (productId, quantity) => {
      if (quantity <= 0) {
        setItems((prev) => prev.filter((it) => it.product.id !== productId));
        return;
      }
      setItems((prev) => prev.map((it) => (it.product.id === productId ? { ...it, quantity } : it)));
    };
    const remove: CustomerCartContextType["remove"] = (productId) => {
      setItems((prev) => prev.filter((it) => it.product.id !== productId));
    };
    const clear = () => setItems([]);
    const totalItems = items.reduce((sum, it) => sum + it.quantity, 0);
    return { items, totalItems, add, setQuantity, remove, clear };
  }, [items]);

  return <CustomerCartContext.Provider value={value}>{children}</CustomerCartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCustomerCart() {
  const ctx = useContext(CustomerCartContext);
  if (!ctx) throw new Error("useCustomerCart must be used within CustomerCartProvider");
  return ctx;
}