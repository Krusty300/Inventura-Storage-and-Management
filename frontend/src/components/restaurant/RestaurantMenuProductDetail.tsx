import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Package, Tag } from "lucide-react";
import api from "../../api/client";
import type { MenuItem, MenuModifierGroup, Product } from "../../types";
import RestaurantSlideOver from "./RestaurantSlideOver";
import ImageCarousel from "../ImageCarousel";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useSettings } from "../../hooks/useSettings";
import { formatCurrency } from "../../utils/currency";
import { errorMessage } from "../../utils/errors";

interface Props {
  menuItem: MenuItem | null;
  onClose: () => void;
}

export default function RestaurantMenuProductDetail({ menuItem, onClose }: Props) {
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const [station, setStation] = useState("");
  const [par, setPar] = useState("0");
  const [warn, setWarn] = useState("0");

  const { data: product } = useQuery({
    queryKey: ["product-detail", menuItem?.id],
    queryFn: async () => menuItem ? (await api.get(`/products/${menuItem.id}`)).data as Product : null,
    enabled: !!menuItem,
  });

  useEffect(() => {
    if (!product) return;
    setStation(product.prep_station ?? "");
    setPar(String(product.par_qty ?? 0));
    setWarn(String(product.warn_qty ?? 0));
  }, [product]);

  const savePrep = useMutation({
    mutationFn: async () => (await api.put(`/restaurant/prep/menu-items/${menuItem!.id}`, {
      prep_station: station.trim() || null,
      par_qty: Number(par) || 0,
      warn_qty: Number(warn) || 0,
    })).data,
    onSuccess: () => {
      addToast("Prep levels updated", "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-prep-stations"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update prep levels"), "error"),
  });

  const { data: groups } = useQuery({
    queryKey: ["restaurant-modifier-groups", menuItem?.id],
    queryFn: async () => menuItem ? (await api.get(`/restaurant/menu-items/${menuItem.id}/modifiers`)).data as MenuModifierGroup[] : [],
    enabled: !!menuItem,
  });

  if (!menuItem) return null;

  const price = (n: number) => formatCurrency(n, symbol);

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

        <div>
          <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
            <ChefHat size={14} /> Prep
          </h3>
          {can("restaurant.prep") ? (
            <div className="card p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs text-muted">Station</span>
                  <input
                    className="input mt-1"
                    value={station}
                    maxLength={60}
                    onChange={(e) => setStation(e.target.value)}
                    placeholder="Not tracked"
                    aria-label="Prep station"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Par</span>
                  <input
                    className="input mt-1"
                    type="number"
                    min={0}
                    value={par}
                    onChange={(e) => setPar(e.target.value)}
                    aria-label="Par level"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Warn at</span>
                  <input
                    className="input mt-1"
                    type="number"
                    min={0}
                    value={warn}
                    onChange={(e) => setWarn(e.target.value)}
                    aria-label="Warn level"
                  />
                </label>
              </div>
              <p className="text-xs text-faint">
                Dishes on a station are counted on the Prep page; clearing the station takes this dish off prep tracking.
              </p>
              <button
                className="btn-primary text-sm"
                disabled={savePrep.isPending || Number(warn) > Number(par)}
                onClick={() => savePrep.mutate()}
              >
                {savePrep.isPending ? "Saving…" : "Save prep levels"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">
              {product?.prep_station
                ? `Prepped at ${product.prep_station} (par ${product.par_qty ?? 0}, warn ${product.warn_qty ?? 0}).`
                : "Not on a prep station."}
            </p>
          )}
        </div>

        {(groups ?? []).length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Modifiers</h3>
            <div className="space-y-3">
              {(groups ?? []).map((g) => (
                <div key={g.id} className="card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-ink">{g.name}</div>
                    <div className="text-xs text-muted flex items-center gap-2">
                      <span>Select {g.min_select}–{g.max_select}</span>
                      {g.is_required && <span className="badge badge-warning text-[10px]">Required</span>}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {g.options.filter((o) => o.is_active).map((o) => (
                      <li key={o.id} className="flex justify-between text-sm text-muted">
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