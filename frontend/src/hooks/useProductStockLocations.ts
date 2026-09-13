import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { SerialNumber, StockLocation } from "../types";

export interface StockLocationSummary {
  location_id: number;
  path: string;
  count: number;
}

interface StockLocationQuery {
  locations: StockLocationSummary[];
  unallocated: number;
}

export function useProductStockLocations(productId: number | null | undefined, isSerialized: boolean) {
  const { data, isLoading } = useQuery<StockLocationQuery>({
    queryKey: ["product-stock-locations", productId, isSerialized],
    queryFn: async () => {
      if (isSerialized) {
        const { data } = await api.get("/serial-numbers", {
          params: { product_id: productId ?? undefined, status: "in_stock", limit: PAGE_SIZE_LOOKUP, offset: 0 },
        });
        const serials = (data?.items || []) as SerialNumber[];
        const map = new Map<number, StockLocationSummary>();
        let unallocated = 0;
        for (const s of serials) {
          if (s.lot_status && s.lot_status !== "in_stock") continue;
          if (!s.location_id) {
            unallocated += 1;
            continue;
          }
          const entry = map.get(s.location_id) || {
            location_id: s.location_id,
            path: s.location_name || "Location",
            count: 0,
          };
          entry.count += 1;
          map.set(s.location_id, entry);
        }
        return { locations: [...map.values()].sort((a, b) => a.path.localeCompare(b.path)), unallocated };
      }
      const { data } = await api.get("/stock-movements/locations", {
        params: { product_id: productId ?? undefined },
      });
      const locations = (data?.locations || []) as StockLocation[];
      return {
        locations: locations
          .filter((l) => l.is_active)
          .map((l) => ({ location_id: l.location_id, path: l.path, count: l.quantity }))
          .sort((a, b) => a.path.localeCompare(b.path)),
        unallocated: data?.unallocated ?? 0,
      };
    },
    enabled: !!productId,
  });
  return { locations: data?.locations ?? [], unallocated: data?.unallocated ?? 0, isLoading };
}
