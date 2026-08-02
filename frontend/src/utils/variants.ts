import type { Product } from "../types";

export const hasVariants = (p: Product): boolean => !!p.variants && p.variants.some((v) => v.is_active);

export const isSelectable = (p: Product): boolean => !hasVariants(p);

export const selectableProducts = (products: Product[]): Product[] => {
  const out: Product[] = [];
  for (const p of products) {
    if (p.is_variant) {
      out.push(p);
    } else if (hasVariants(p)) {
      for (const v of p.variants || []) {
        if (v.is_active) out.push(v);
      }
    } else {
      out.push(p);
    }
  }
  return out;
};

export const productLabel = (p: Product): string => `${p.display_name} (${p.sku})`;
