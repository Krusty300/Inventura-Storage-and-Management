import { useEffect, useState } from "react";
import api from "../api/client";
import type { Product } from "../types";
import { selectableProducts } from "../utils/variants";

export function useSelectableProducts(): Product[] {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    api
      .get("/products", { params: { active_only: true, limit: 1000, include_variants: 1 } })
      .then(({ data }) => setProducts(data.items));
  }, []);
  return selectableProducts(products);
}
