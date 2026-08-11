import { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Product } from "../types";
import { selectableProducts } from "../utils/variants";

export function useSelectableProducts(): Product[] {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    api
      .get("/products", { params: { active_only: true, limit: PAGE_SIZE_PRODUCTS, include_variants: 1 } })
      .then(({ data }) => setProducts(data.items));
  }, []);
  return useMemo(() => selectableProducts(products), [products]);
}
