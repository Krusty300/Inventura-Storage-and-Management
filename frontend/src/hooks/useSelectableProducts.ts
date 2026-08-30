import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Product } from "../types";
import { selectableProducts } from "../utils/variants";

export function useSelectableProducts(): Product[] {
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products", "selectable"],
    queryFn: async () => {
      const { data } = await api.get("/products", { params: { active_only: true, limit: PAGE_SIZE_PRODUCTS, include_variants: 1 } });
      return data.items;
    },
  });
  return useMemo(() => selectableProducts(products), [products]);
}
