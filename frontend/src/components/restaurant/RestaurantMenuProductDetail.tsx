import { useQuery } from "@tanstack/react-query";
import { Package, Tag } from "lucide-react";
import api from "../../api/client";
import type { MenuItem, MenuModifierGroup, Product } from "../../types";
import RestaurantSlideOver from "./RestaurantSlideOver";
import ImageCarousel from "../ImageCarousel";
import { useSettings } from "../../hooks/useSettings";

interface Props {
  menuItem: MenuItem | null;
  onClose: () => void;
}

export default function RestaurantMenuProductDetail({ menuItem, onClose }: Props) {
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";

  const { data: product } = useQuery({
    queryKey: ["product-detail", menuItem?.id],
    queryFn: async () => menuItem ? (await api.get(`/products/${menuItem.id}`)).data as Product : null,
    enabled: !!menuItem,
  });

  const { data: groups } = useQuery({
    queryKey: ["restaurant-modifier-groups", menuItem?.id],
    queryFn: async () => menuItem ? (await api.get(`/restaurant/menu-items/${menuItem.id}/modifiers`)).data as MenuModifierGroup[] : [],
    enabled: !!menuItem,
  });

  if (!menuItem) return null;

  const price = (n: number) => `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <RestaurantSlideOver
      open
      onClose={onClose}
      title={menuItem.display_name}
      breadcrumb={`Menu item ${menuItem.display_name}`}
      actions={
        <span className="font-semibold text-primary-strong dark:text-primary tabular-nums">
          {price(menuItem.unit_price)}
        </span>
      }
    >
      <div className="space-y-5">
        {product ? (
          <ImageCarousel images={product.images ?? []} imageUrl={product.image_url} alt={menuItem.display_name} />
        ) : (
          <div className="animate-pulse h-64 rounded-lg bg-app" />
        )}

        <div className="flex flex-wrap gap-3 text-sm">
          {menuItem.sku && (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Tag size={14} /> {menuItem.sku}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Package size={14} /> {product ? `${product.sellable_qty ?? product.quantity} in stock` : "Menu item"}
          </span>
        </div>

        {menuItem.description && (
          <div>
            <h3 className="text-sm font-semibold text-ink mb-1">About</h3>
            <p className="text-sm text-muted whitespace-pre-wrap">{menuItem.description}</p>
          </div>
        )}

        {(groups ?? []).length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Modifiers</h3>
            <div className="space-y-3">
              {(groups ?? []).map((g) => (
                <div key={g.name} className="card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-ink">{g.name}</div>
                    <div className="text-xs text-muted flex items-center gap-2">
                      <span>Select {g.min_select}–{g.max_select}</span>
                      {g.is_required && <span className="badge badge-warning text-[10px]">Required</span>}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {g.options.filter((o) => o.is_active).map((o) => (
                      <li key={o.name} className="flex justify-between text-sm text-muted">
                        <span>{o.name}</span>
                        <span className="tabular-nums">{o.price_delta >= 0 ? "+" : "-"}{price(Math.abs(o.price_delta))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </RestaurantSlideOver>
  );
}