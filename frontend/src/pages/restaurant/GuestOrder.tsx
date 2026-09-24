import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed, Clock3 } from "lucide-react";
import api from "../../api/client";
import { formatCurrency } from "../../utils/currency";
import { errorMessage } from "../../utils/errors";
import { entityImageUrl } from "../../utils/images";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import Modal from "../../components/Modal";
import type { MenuSectionWithItems, MenuItem, MenuModifierGroup, RestaurantTable, RestaurantTicketItem } from "../../types";

export interface GuestOrderOut {
  id: number;
  ticket_number: string;
  table_id: number | null;
  table_number: string;
  status: string;
  guest_count: number;
  guest_name: string;
  subtotal: number;
  total_amount: number;
  opened_at: string;
  items: RestaurantTicketItem[];
}

interface CartLine {
  key: string;
  product: MenuItem;
  quantity: number;
  modifiers: { group_id: number; option_id: number }[];
  modifierNames: string[];
  notes: string;
  extras: number;
}

const CART_KEY = "guest-cart";

function ModifierSheet({ product, onClose, onAdd }: {
  product: MenuItem;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, "key">) => void;
}) {
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const { data: groups, isLoading } = useQuery({
    queryKey: ["public-modifiers", product.id],
    queryFn: async () => (await api.get(`/restaurant/public/menu-items/${product.id}/modifiers`)).data as MenuModifierGroup[],
  });

  const groupList = groups ?? [];
  const chosen = (gid: number) => selections[gid] ?? [];
  const extras = groupList.reduce(
    (sum, g) => sum + chosen(g.id).reduce((s, oid) => s + (g.options.find((o) => o.id === oid)?.price_delta ?? 0), 0),
    0,
  );
  const unitPrice = product.unit_price + extras;

  const toggle = (gid: number, oid: number) => {
    const g = groupList.find((x) => x.id === gid);
    if (!g) return;
    const cur = chosen(gid);
    if (cur.includes(oid)) {
      setSelections({ ...selections, [gid]: cur.filter((x) => x !== oid) });
    } else if (cur.length >= g.max_select) {
      setError(`You can select at most ${g.max_select} for ${g.name}.`);
    } else {
      setSelections({ ...selections, [gid]: [...cur, oid] });
    }
  };

  const handleAdd = () => {
    setError("");
    for (const g of groupList) {
      const minimum = Math.max(g.min_select, g.is_required ? 1 : 0);
      if (chosen(g.id).length < minimum) {
        setError(`Please choose at least ${minimum} for ${g.name}.`);
        return;
      }
    }
    onAdd({
      product,
      quantity,
      modifiers: groupList.flatMap((g) => chosen(g.id).map((oid) => ({ group_id: g.id, option_id: oid }))),
      modifierNames: groupList.flatMap((g) => chosen(g.id).map((oid) => g.options.find((o) => o.id === oid)?.name || "Option")),
      notes: notes.trim(),
      extras,
    });
    onClose();
  };

  const verifyMin = (g: MenuModifierGroup, oid: number): string | null => {
    const n = chosen(g.id).includes(oid) ? chosen(g.id).length - 1 : chosen(g.id).length + 1;
    if (n < g.min_select) return `At least ${g.min_select} required for ${g.name}.`;
    return null;
  };

  return (
    <Modal open onClose={onClose} title={product.display_name}>
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
        <div className="text-sm text-muted">Each · {formatCurrency(unitPrice)}</div>

        {isLoading ? (
          <div className="card p-4 animate-pulse h-16" />
        ) : groupList.length === 0 ? (
          <p className="text-sm text-muted">No options for this item.</p>
        ) : (
          groupList.map((g) => (
            <div key={g.id}>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="font-medium text-ink">
                  {g.name}
                  {g.is_required && <span className="text-xs text-red-600 dark:text-red-400 ml-1">required</span>}
                </span>
                <span className="text-xs text-muted">{chosen(g.id).length}/{g.max_select}{g.min_select > 0 && ` · min ${g.min_select}`}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.options.filter((o) => o.is_active).map((o) => {
                  const on = chosen(g.id).includes(o.id);
                  const disabled = !on && verifyMin(g, o.id) !== null && chosen(g.id).length >= g.max_select;
                  return (
                    <button
                      key={o.id}
                      onClick={() => toggle(g.id, o.id)}
                      disabled={Boolean(disabled)}
                      aria-pressed={on}
                      className={`border rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        on ? "border-primary-strong bg-primary-soft text-primary-strong dark:text-primary" : "border-border text-ink hover:border-primary-soft"
                      }`}
                    >
                      {o.name}{o.price_delta > 0 ? ` (+${formatCurrency(o.price_delta)})` : o.price_delta < 0 ? ` (−${formatCurrency(-o.price_delta)})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted">Quantity</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:bg-subtle" aria-label="Decrease quantity"><Minus size={14} /></button>
            <span className="w-10 text-center text-sm font-medium text-ink">{quantity}</span>
            <button onClick={() => setQuantity(Math.min(99, quantity + 1))} className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:bg-subtle" aria-label="Increase quantity"><Plus size={14} /></button>
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-muted">Note to kitchen (optional)</span>
          <textarea
            className="input mt-1.5"
            rows={2}
            value={notes}
            maxLength={200}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. no onions, allergies..."
          />
        </label>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-sm">{error}</div>
        )}

        <button onClick={handleAdd} className="btn-primary w-full">
          Add {quantity} × {formatCurrency(unitPrice * quantity)}
        </button>
      </div>
    </Modal>
  );
}

export default function GuestOrder() {
  const { tableId } = useParams();
  const tid = tableId ? Number(tableId) : null;
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) ?? "[]") as CartLine[];
    } catch {
      return [];
    }
  });
  const [pick, setPick] = useState<MenuItem | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [placed, setPlaced] = useState<GuestOrderOut | null>(null);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const { data: table, isLoading: tableLoading, error: tableError } = useQuery({
    queryKey: ["public-table", tid],
    queryFn: async () => (await api.get(`/restaurant/public/tables/${tid}`)).data as RestaurantTable,
    enabled: tid != null,
  });

  const { data: menu, isLoading: menuLoading } = useQuery({
    queryKey: ["public-menu"],
    queryFn: async () => (await api.get("/restaurant/public/menu")).data as MenuSectionWithItems[],
  });

  const { data: order, refetch: refetchOrder } = useQuery({
    queryKey: ["public-order", placed?.id],
    queryFn: async () => (await api.get(`/restaurant/public/orders/${placed!.id}`)).data as GuestOrderOut,
    enabled: placed != null,
    refetchInterval: 6000,
  });

  const canOrder =
    tid != null &&
    cart.length > 0 &&
    (order == null || order.status === "open");

  const subtotal = cart.reduce((sum, l) => sum + (l.product.unit_price + l.extras) * l.quantity, 0);
  const totalQty = cart.reduce((sum, l) => sum + l.quantity, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (tid == null) throw new Error("Table not found");
      const { data } = await api.post("/restaurant/public/orders", {
        table_id: tid,
        guest_name: guestName.trim(),
        guest_count: guestCount,
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          modifiers: l.modifiers,
          notes: l.notes,
        })),
      } as never);
      return data as GuestOrderOut;
    },
    onSuccess: (ord) => {
      setPlaced(ord);
      setCart([]);
      localStorage.removeItem(CART_KEY);
      refetchOrder();
    },
  });

  const setLineQty = (key: string, delta: number) => {
    setCart((prev) => prev.flatMap((l) => {
      if (l.key !== key) return [l];
      const next = l.quantity + delta;
      return next <= 0 || next > 99 ? [] : [{ ...l, quantity: next }];
    }));
  };

  const removeLine = (key: string) => setCart((prev) => prev.filter((l) => l.key !== key));

  if (placed && order) {
    const serving = order.items;
    return (
      <div className="min-h-screen bg-app px-4 py-8">
        <div className="max-w-md mx-auto space-y-5">
          <div className="card p-6 text-center">
            <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-primary-soft text-primary-strong dark:text-primary flex items-center justify-center">
              <UtensilsCrossed size={26} />
            </div>
            <h1 className="text-xl font-bold text-ink">Order {order.ticket_number}</h1>
            <p className="text-sm text-muted mt-1">Table {order.table_number || "—"} {guestName.trim() ? `· ${guestName.trim()}` : ""}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-app px-2 py-2">
                <p className="text-xs text-muted">Items</p>
                <p className="font-bold text-ink">{serving.length}</p>
              </div>
              <div className="rounded-lg bg-app px-2 py-2">
                <p className="text-xs text-muted">Status</p>
                <p className="font-bold capitalize text-primary-strong dark:text-primary">{order.status}</p>
              </div>
              <div className="rounded-lg bg-app px-2 py-2">
                <p className="text-xs text-muted">Total</p>
                <p className="font-bold text-ink">{formatCurrency(order.total_amount)}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-sm text-muted">
              <Clock3 size={14} />
              {serving.length > 0 && serving.some((i) => i.status === "queued" || i.status === "preparing")
                ? "Your order is being prepared."
                : serving.every((i) => i.status === "served")
                  ? "All items served — enjoy!"
                  : "Kitchen has your items."}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-bold text-ink mb-3">Order details</h2>
            <ul className="space-y-2.5">
              {serving.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-ink">{i.quantity} × {i.product_name}</p>
                    {i.modifiers && i.modifiers.length > 0 && (
                      <p className="text-xs text-muted mt-0.5">{i.modifiers.map((m) => m.name).join(", ")}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs capitalize px-2 py-0.5 rounded-full bg-app text-muted">
                    {i.status === "ready" ? "Ready" : i.status === "served" ? "Served" : "Preparing"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border mt-4 pt-3 flex justify-between text-sm">
              <span className="text-muted">Total (incl. tax)</span>
              <span className="font-bold text-ink">{formatCurrency(order.total_amount)}</span>
            </div>
          </div>

          <button
            onClick={() => { setPlaced(null); }}
            className="btn-secondary w-full"
          >
            Add more items
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app px-4 py-8">
      <div className="max-w-md mx-auto space-y-5">
        <header className="text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary-soft text-primary-strong dark:text-primary flex items-center justify-center">
            <ShoppingBag size={22} />
          </div>
          <h1 className="text-xl font-bold text-ink">Order from your table</h1>
          <p className="text-sm text-muted mt-1">
            {tableLoading ? "Checking table..." : table ? `Table ${table.number} · seats ${table.capacity}` : tableError ? "Table unavailable" : "Table not found"}
          </p>
        </header>

        {tableLoading || menuLoading ? (
          <div className="card p-4 animate-pulse h-40" />
        ) : (
          (menu ?? []).map((section) => (
            <section key={String(section.id)}>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h2 className="font-semibold text-ink">{section.name}</h2>
                <span className="text-xs text-faint">{section.item_count} item{section.item_count === 1 ? "" : "s"}</span>
              </div>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setPick(item)}
                    className="w-full card p-3.5 flex items-center gap-3 text-left"
                  >
                    <div className="h-16 w-16 shrink-0 rounded-lg bg-subtle-strong overflow-hidden">
                      <img
                        src={item.image_url || item.image ? entityImageUrl(item.image_url || item.image) : getPlaceholder()}
                        alt={item.display_name}
                        onError={onImageError}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink leading-snug">{item.display_name}</p>
                      {item.description && <p className="text-xs text-muted mt-0.5 line-clamp-2">{item.description}</p>}
                      <p className="text-sm font-bold text-primary-strong dark:text-primary mt-1">{formatCurrency(item.unit_price)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}

        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-ink">Your order</h2>
            <span className="text-xs text-faint">{totalQty} item{totalQty === 1 ? "" : "s"}</span>
          </div>
          {cart.length === 0 ? (
            <p className="text-sm text-muted py-3 text-center">Tap a menu item to add it.</p>
          ) : (
            <ul className="divide-y divide-border">
              {cart.map((l) => (
                <li key={l.key} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{l.product.display_name} × {l.quantity}</p>
                    {l.modifierNames.length > 0 && (
                      <p className="text-xs text-muted mt-0.5 line-clamp-1">{l.modifierNames.join(", ")}</p>
                    )}
                    {l.notes && <p className="text-xs text-faint mt-0.5 line-clamp-1">Note: {l.notes}</p>}
                    <p className="text-sm font-bold text-ink mt-0.5">{formatCurrency((l.product.unit_price + l.extras) * l.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setLineQty(l.key, -1)} className="p-1 rounded-md border border-border text-muted hover:text-ink" aria-label="Decrease"><Minus size={13} /></button>
                    <span className="w-6 text-center text-sm">{l.quantity}</span>
                    <button onClick={() => setLineQty(l.key, 1)} className="p-1 rounded-md border border-border text-muted hover:text-ink" aria-label="Increase"><Plus size={13} /></button>
                    <button onClick={() => removeLine(l.key)} className="p-1 rounded-md text-faint hover:text-red-600" aria-label="Remove"><Trash2 size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {cart.length > 0 && (
            <>
              <label className="block mt-4">
                <span className="text-xs font-medium text-muted">Your name (optional)</span>
                <input className="input mt-1" value={guestName} maxLength={80} onChange={(e) => setGuestName(e.target.value)} placeholder="e.g. Alex" />
              </label>
              <label className="block mt-3">
                <span className="text-xs font-medium text-muted">People at your table</span>
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => setGuestCount(Math.max(1, guestCount - 1))} className="p-1.5 rounded-lg border border-border text-muted hover:text-ink" aria-label="Fewer people"><Minus size={14} /></button>
                  <span className="w-8 text-center font-medium text-ink">{guestCount}</span>
                  <button onClick={() => setGuestCount(Math.min(99, guestCount + 1))} className="p-1.5 rounded-lg border border-border text-muted hover:text-ink" aria-label="More people"><Plus size={14} /></button>
                </div>
              </label>
            </>
          )}

          <div className="flex justify-between items-center mt-4 border-t border-border pt-3">
            <span className="text-sm text-muted">Subtotal</span>
            <span className="font-bold text-ink">{formatCurrency(subtotal)}</span>
          </div>

          {mutation.isError && (
            <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-sm mt-3">
              {errorMessage(mutation.error, "Could not place order")}
            </div>
          )}

          <button
            onClick={() => mutation.mutate()}
            disabled={!canOrder || mutation.isPending}
            className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
          >
            {mutation.isPending ? (
              <>
                <span className="h-4 w-4 rounded bg-white/40 animate-pulse" />
                Placing order…
              </>
            ) : (
              `Send order · ${formatCurrency(subtotal)}`
            )}
          </button>
          {!canOrder && !mutation.isPending && (
            <p className="text-xs text-faint text-center mt-2">
              {tid == null ? "This link is missing a table." : cart.length === 0 ? "Add at least one item to order." : "This table already has an active order."}
            </p>
          )}
        </div>
      </div>

      {pick && (
        <ModifierSheet
          product={pick}
          onClose={() => setPick(null)}
          onAdd={(line) => {
            const label = [
              line.product.id,
              line.quantity,
              line.notes,
              ...line.modifiers.map((m) => `${m.group_id}:${m.option_id}`),
            ].join("|");
            const existing = cart.find((l) => l.key === label);
            if (existing) {
              setCart((prev) => prev.map((l) =>
                l.key === label ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l,
              ));
            } else {
              setCart((prev) => [...prev, { ...line, key: label }]);
            }
          }}
        />
      )}
    </div>
  );
}