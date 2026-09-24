import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  UtensilsCrossed, Search, Plus, Minus, Trash2, Send, ChefHat, CheckCheck,
  Banknote, Printer, X, Pencil, StickyNote, Ban, Scissors,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type {
  MenuItem, MenuModifierGroup, MenuSectionWithItems, Product, RestaurantTicket, RestaurantTicketItem,
} from "../../types";
import EmptyState from "../../components/EmptyState";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import PaymentMethodPicker from "../../components/PaymentMethodPicker";
import BarcodeScanner from "../../components/BarcodeScanner";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useSettings } from "../../hooks/useSettings";
import { formatDateTime } from "../../utils/date";
import { paymentLabel } from "../../utils/payments";
import { errorMessage } from "../../utils/errors";
import { printBlob } from "../../utils/download";

const TICKET_BADGE: Record<string, string> = {
  open: "badge-neutral",
  preparing: "badge-info",
  ready: "badge-warning",
  served: "badge-info",
  paying: "badge-warning",
  settled: "badge-success",
  cancelled: "badge-danger",
};

export default function RestaurantTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { subscribe } = useRealtime();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";

  const [menuSearch, setMenuSearch] = useState("");
  const [showSettle, setShowSettle] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editTicket, setEditTicket] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<MenuItem | null>(null);
  const [voidItem, setVoidItem] = useState<RestaurantTicketItem | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const { menu: menuBlocks = [] } = useMenuData(menuSearch);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.entity === "restaurant_ticket") {
        queryClient.invalidateQueries({ queryKey: ["restaurant-ticket", ticketId] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
      }
    });
    return unsub;
  }, [subscribe, queryClient, ticketId]);

  const { data: ticket, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-ticket", ticketId],
    queryFn: async () => {
      const { data } = await api.get(`/restaurant/tickets/${ticketId}`);
      return data as RestaurantTicket;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["restaurant-ticket", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-tickets"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
  };

  const addItem = useMutation({
    mutationFn: async ({ productId, quantity, modifiers, notes }: { productId: number; quantity: number; modifiers?: { group_id: number; option_id: number }[]; notes?: string }) => {
      const payload: Record<string, unknown> = { product_id: productId, quantity };
      if (modifiers?.length) payload.modifiers = modifiers;
      if (notes?.trim()) payload.notes = notes.trim();
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/items`, payload);
      return data;
    },
    onSuccess: () => { invalidate(); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot add item"), "error"),
  });

  const updateTicket = useMutation({
    mutationFn: async (fields: { customer_name?: string; guest_count?: number; notes?: string }) => {
      const { data } = await api.put(`/restaurant/tickets/${ticketId}`, fields);
      return data as RestaurantTicket;
    },
    onSuccess: () => { invalidate(); addToast("Ticket updated", "success"); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update ticket"), "error"),
  });

  const updateItem = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: number; quantity: number }) => {
      const { data } = await api.put(`/restaurant/tickets/${ticketId}/items/${itemId}`, { quantity });
      return data;
    },
    onSuccess: () => { invalidate(); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update item"), "error"),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: number) => {
      const { data } = await api.delete(`/restaurant/tickets/${ticketId}/items/${itemId}`);
      return data;
    },
    onSuccess: () => { invalidate(); addToast("Item removed", "success"); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot remove item"), "error"),
  });

  const voidItemMutation = useMutation({
    mutationFn: async ({ itemId, reason }: { itemId: number; reason?: string }) => {
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/items/${itemId}/void`, { reason: reason ?? "" });
      return data;
    },
    onSuccess: () => { invalidate(); addToast("Item voided", "success"); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot void item"), "error"),
  });

  const splitTicket = useMutation({
    mutationFn: async ({ itemIds, tableId, guestCount, customerName, notes }: {
      itemIds: number[]; tableId?: number | null; guestCount?: number | null; customerName?: string; notes?: string;
    }) => {
      const payload: Record<string, unknown> = { item_ids: itemIds };
      if (tableId) payload.table_id = tableId;
      if (guestCount) payload.guest_count = guestCount;
      if (customerName) payload.customer_name = customerName;
      if (notes) payload.notes = notes;
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/split`, payload);
      return data as RestaurantTicket;
    },
    onSuccess: (child) => {
      invalidate();
      addToast(`Split ${ticket?.ticket_number ?? ""} — new bill ${child.ticket_number}`, "success");
      navigate(`/restaurant/tickets/${child.id}`);
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot split ticket"), "error"),
  });

  const sendToKitchen = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/send`);
      return data;
    },
    onSuccess: () => { invalidate(); addToast("Sent to kitchen — stock reserved", "success"); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot send to kitchen"), "error"),
  });

  const serve = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/serve`);
      return data;
    },
    onSuccess: () => { invalidate(); addToast("Items served", "success"); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot serve ticket"), "error"),
  });

  const cancelTicket = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/cancel`);
      return data;
    },
    onSuccess: () => { invalidate(); addToast("Ticket cancelled", "success"); navigate("/restaurant"); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot cancel ticket"), "error"),
  });

  const menuProducts = useMemo(() => menuBlocks.flatMap((b) => b.items), [menuBlocks]);

  const onBarcode = (p: Product) => {
    const match = menuProducts.find((m) => m.id === p.id);
    if (!match) {
      addToast(`${p.display_name || p.sku} is not on the menu`, "error");
      return;
    }
    setModifierProduct(match);
  };
  const pendingItems = (ticket?.items ?? []).filter((i) => i.status === "pending");
  const canEdit = ticket && !["settled", "cancelled", "paying"].includes(ticket.status);

  const currencyAmount = (n: number) => `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const printPdf = async (path: string) => {
    try {
      const { data } = await api.get(path, { responseType: "blob" });
      printBlob(data);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Cannot print"), "error");
    }
  };

  if (isLoading) {
    return <div className="grid gap-6 lg:grid-cols-[1fr_360px]"><div className="card p-6 animate-pulse h-72" /><div className="card p-6 animate-pulse h-72" /></div>;
  }

  if (isError || !ticket) {
    return (
      <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
        {errorMessage(error, "Failed to load ticket")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <UtensilsCrossed size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-ink">{ticket.ticket_number}</h1>
              <span className={`badge ${TICKET_BADGE[ticket.status] ?? "badge-neutral"}`}>{ticket.status}</span>
            </div>
            <p className="text-sm text-muted mt-1">
              {ticket.table_number} · {ticket.guest_count} guest{ticket.guest_count === 1 ? "" : "s"} · opened {formatDateTime(ticket.opened_at)} · {ticket.username}
            </p>
            {ticket.notes && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <StickyNote size={12} /> {ticket.notes}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => printPdf(`/restaurant/tickets/${ticketId}/bill`)} className="btn-secondary flex items-center gap-1.5" aria-label={`Print bill for ${ticket.ticket_number}`}>
            <Printer size={16} /> Bill
          </button>
          <button onClick={() => printPdf(`/restaurant/tickets/${ticketId}/kitchen`)} className="btn-secondary flex items-center gap-1.5" aria-label={`Print kitchen ticket for ${ticket.ticket_number}`}>
            <Printer size={16} /> Kitchen
          </button>
          {canEdit && can("restaurant.update") && (
            <>
              <button onClick={() => setShowSplit(true)} className="btn-secondary flex items-center gap-1.5" aria-label={`Split ${ticket.ticket_number}`}>
                <Scissors size={16} /> Split
              </button>
              <button onClick={() => setEditTicket(true)} className="btn-secondary" aria-label={`Edit ${ticket.ticket_number}`}>
                <Pencil size={16} /> Edit
              </button>
              <button onClick={() => { setConfirmCancel(true); }} className="btn-secondary" aria-label={`Cancel ${ticket.ticket_number}`}>
                <X size={16} /> Cancel
              </button>
            </>
          )}
          {canEdit && can("restaurant.settle") && (
            <button onClick={() => setShowSettle(true)} className="btn-primary flex items-center gap-1.5">
              <Banknote size={16} /> Settle · {currencyAmount(ticket.total_amount)}
            </button>
          )}
        </div>
      </div>

      {canEdit && ticket.status === "open" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="card p-5">
            <div className="relative max-w-md mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                className="input pl-10"
                placeholder="Search the menu..."
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                aria-label="Search menu"
              />
            </div>
            <div className="mb-4">
              <BarcodeScanner onProductFound={onBarcode} placeholder="Scan barcode..." />
            </div>
            {menuProducts.length === 0 ? (
              <EmptyState
                variant="block"
                icon={<ChefHat size={48} />}
                title={menuSearch.trim() ? "No menu items found" : "No menu items yet"}
                message={menuSearch.trim() ? "Try a different search." : "Mark products as menu items in the product form so they appear here."}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {menuProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setModifierProduct(p); }}
                    className="card p-3 text-left hover:bg-app transition flex items-center gap-3"
                  >
                    {p.image_url && (
                      <img src={p.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-app shrink-0" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink truncate">{p.display_name}</div>
                      <div className="text-xs text-muted mt-0.5">{currencyAmount(p.unit_price)}</div>
                    </div>
                    <span className="p-2 rounded-lg bg-primary-soft text-primary-strong dark:text-primary shrink-0">
                      <Plus size={16} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card p-5 flex flex-col gap-4">
            <h2 className="font-semibold text-ink">Order</h2>
            {pendingItems.length === 0 ? (
              <EmptyState compact icon={<Plus size={20} />} title="No items yet" message="Tap menu items to build this order." />
            ) : (
              <ul className="divide-y divide-border">
                {pendingItems.map((item) => (
                  <li key={item.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{item.product_name}</div>
                      {item.modifiers?.length ? (
                        <div className="text-xs text-muted mt-0.5">{item.modifiers.map((m) => `+${m.name}`).join(" · ")}</div>
                      ) : null}
                      <div className="text-xs text-muted mt-0.5">{currencyAmount(item.unit_price)} each</div>
                    </div>
                    {can("restaurant.update") ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateItem.mutate({ itemId: item.id, quantity: item.quantity - 1 })} disabled={item.quantity <= 1} className="p-1 rounded-md bg-app text-muted hover:text-ink disabled:opacity-40" aria-label={`Decrease ${item.product_name}`}>
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center tabular-nums">{item.quantity}</span>
                        <button onClick={() => updateItem.mutate({ itemId: item.id, quantity: item.quantity + 1 })} className="p-1 rounded-md bg-app text-muted hover:text-ink" aria-label={`Increase ${item.product_name}`}>
                          <Plus size={14} />
                        </button>
                        <button onClick={() => removeItem.mutate(item.id)} className="p-1 rounded-md text-faint hover:text-red-600 dark:text-red-400" aria-label={`Remove ${item.product_name}`}>
                          <Trash2 size={14} />
                        </button>
                        <button onClick={() => setVoidItem(item)} className="p-1 rounded-md text-faint hover:text-red-600 dark:text-red-400" aria-label={`Void ${item.product_name}`}>
                          <Ban size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm tabular-nums">×{item.quantity}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto pt-2 space-y-1 text-sm border-t border-border">
              <div className="flex justify-between text-muted"><span>Subtotal</span><span className="tabular-nums">{currencyAmount(ticket.subtotal)}</span></div>
              {ticket.discount_amount > 0 && <div className="flex justify-between text-muted"><span>Discount</span><span className="tabular-nums">-{currencyAmount(ticket.discount_amount)}</span></div>}
              {ticket.tax_amount > 0 && <div className="flex justify-between text-muted"><span>Tax</span><span className="tabular-nums">{currencyAmount(ticket.tax_amount)}</span></div>}
              {ticket.tip_amount > 0 && <div className="flex justify-between text-muted"><span>Tip</span><span className="tabular-nums">{currencyAmount(ticket.tip_amount)}</span></div>}
              <div className="flex justify-between font-semibold text-ink pt-1"><span>Total</span><span className="tabular-nums">{currencyAmount(ticket.total_amount)}</span></div>
            </div>
            {can("restaurant.create") && pendingItems.length > 0 && (
              <button onClick={() => sendToKitchen.mutate()} disabled={sendToKitchen.isPending} className="btn-primary w-full flex items-center justify-center gap-1.5">
                <Send size={16} /> Send to Kitchen
              </button>
            )}
          </section>
        </div>
      )}

      {canEdit && ticket.status !== "open" && (
        <div className="card p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-semibold text-ink">Kitchen</h2>
            {ticket.items.length > 0 && ticket.items.every((i) => i.status === "served") && can("restaurant.update") && (
              <button onClick={() => serve.mutate()} disabled={serve.isPending} className="btn-secondary flex items-center gap-1.5">
                <CheckCheck size={16} /> Mark Served
              </button>
            )}
          </div>
          <ul className="divide-y divide-border">
            {ticket.items.map((item) => (
              <li key={item.id} className={`py-3 flex items-center justify-between gap-3 ${item.status === "voided" ? "opacity-60" : ""}`}>
                <div>
                  <div className={`font-medium ${item.status === "voided" ? "text-muted line-through" : "text-ink"}`}>{item.product_name}</div>
                  {item.modifiers?.length ? (
                    <div className="text-xs text-muted mt-0.5">{item.modifiers.map((m) => `+${m.name}`).join(" · ")}</div>
                  ) : null}
                  <div className="text-xs text-muted mt-0.5">×{item.quantity} · {currencyAmount(item.unit_price)}</div>
                  {item.status === "voided" && item.void_reason && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">Voided: {item.void_reason}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {item.status === "voided" ? (
                    <span className="badge badge-danger">voided</span>
                  ) : (
                    <>
                      <span className={`badge ${item.status === "served" ? "badge-success" : item.status === "ready" ? "badge-warning" : item.status === "preparing" ? "badge-info" : "badge-neutral"}`}>
                        {item.status}
                      </span>
                      {canEdit && can("restaurant.update") && (
                        <button onClick={() => setVoidItem(item)} className="p-1 rounded-md text-faint hover:text-red-600 dark:text-red-400" aria-label={`Void ${item.product_name}`}>
                          <Ban size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ticket.status === "settled" && (
        <div className="card p-5 text-center">
          <CheckCheck size={32} className="mx-auto mb-3 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-ink">Ticket settled</h2>
          <p className="text-sm text-muted mt-1">Settled {formatDateTime(ticket.settled_at)} for {currencyAmount(ticket.total_amount)}{ticket.tip_amount > 0 && ` plus a ${currencyAmount(ticket.tip_amount)} tip`}.</p>
        </div>
      )}

      {ticket.status === "paying" && (
        <div className="card p-5 text-center">
          <h2 className="text-lg font-bold text-ink">Awaiting mobile money confirmation</h2>
          <p className="text-sm text-muted mt-1">The ticket settles automatically once the STK payment is confirmed.</p>
        </div>
      )}

      <VoidItemModal
        open={voidItem !== null}
        item={voidItem}
        onClose={() => setVoidItem(null)}
        onConfirm={(reason) => {
          if (!voidItem) return;
          voidItemMutation.mutate({ itemId: voidItem.id, reason });
          setVoidItem(null);
        }}
      />

      <SplitBillModal
        open={showSplit}
        ticket={ticket}
        onClose={() => setShowSplit(false)}
        onSplit={(payload) => {
          setShowSplit(false);
          splitTicket.mutate(payload);
        }}
      />

      <SettleModal
        open={showSettle}
        ticket={ticket}
        onClose={() => setShowSettle(false)}
        onSettled={(updated, methodLabel) => {
          setShowSettle(false);
          invalidate();
          if (updated.status === "paying") {
            addToast("Ticket marked for payment — STK Push sent", "success");
          } else {
            addToast(`Settled via ${methodLabel}`, "success");
          }
        }}
      />

      {modifierProduct && (
        <ModifierModal
          product={modifierProduct}
          symbol={symbol}
          onClose={() => setModifierProduct(null)}
          onAdd={(productId, quantity, modifiers, notes) => {
            addItem.mutate({ productId, quantity, modifiers, notes });
            setModifierProduct(null);
            addToast("Item added to order", "success");
          }}
        />
      )}

      <EditTicketModal
        open={editTicket}
        ticket={ticket}
        onClose={() => setEditTicket(false)}
        onSave={(fields) => {
          updateTicket.mutate(fields);
          setEditTicket(false);
        }}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel Ticket"
        message={`Cancel ${ticket.ticket_number}? Any stock already sent to the kitchen will be returned.`}
        confirmLabel="Cancel Ticket"
        confirmClass="btn-danger"
        onConfirm={() => { setConfirmCancel(false); cancelTicket.mutate(); }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

function useMenuData(search: string) {
  const { data: menu } = useQuery({
    queryKey: ["restaurant-menu"],
    queryFn: async () => (await api.get("/restaurant/menu")).data as MenuSectionWithItems[],
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!menu) return [];
    if (!q) return menu;
    return menu
      .map((block) => ({
        ...block,
        items: block.items.filter(
          (i) => i.display_name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q),
        ),
      }))
      .filter((block) => block.items.length > 0);
  }, [menu, q]);

  return { menu: filtered };
}

function ModifierModal({ product, symbol, onClose, onAdd }: {
  product: MenuItem;
  symbol: string;
  onClose: () => void;
  onAdd: (productId: number, quantity: number, modifiers: { group_id: number; option_id: number }[], notes?: string) => void;
}) {
  const { addToast } = useToast();
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const { data: groups, isLoading } = useQuery({
    queryKey: ["restaurant-modifier-groups", product.id],
    queryFn: async () => (await api.get(`/restaurant/menu-items/${product.id}/modifiers`)).data as MenuModifierGroup[],
  });

  const groupList = groups?.filter((g) => g.is_active) ?? [];
  const chosen = (gid: number) => selections[gid] ?? [];
  const priceOf = (gid: number) => {
    const g = groupList.find((x) => x.id === gid);
    if (!g) return 0;
    return chosen(gid).reduce((sum, oid) => sum + (g.options.find((o) => o.id === oid)?.price_delta ?? 0), 0);
  };
  const extras = groupList.reduce((sum, g) => sum + priceOf(g.id), 0);
  const unitPrice = product.unit_price + extras;
  const lineTotal = unitPrice * quantity;

  const toggle = (gid: number, oid: number) => {
    const g = groupList.find((x) => x.id === gid);
    if (!g) return;
    const cur = chosen(gid);
    if (cur.includes(oid)) {
      setSelections({ ...selections, [gid]: cur.filter((x) => x !== oid) });
    } else if (cur.length >= g.max_select) {
      addToast(`You can select at most ${g.max_select} option${g.max_select === 1 ? "" : "s"} for ${g.name}`, "error");
    } else {
      setSelections({ ...selections, [gid]: [...cur, oid] });
    }
  };

  const handleAdd = () => {
    for (const g of groupList) {
      const minimum = Math.max(g.min_select, g.is_required ? 1 : 0);
      if (chosen(g.id).length < minimum) {
        addToast(`Select at least ${minimum} option${minimum === 1 ? "" : "s"} for ${g.name}`, "error");
        return;
      }
    }
    const modifiers = groupList.flatMap((g) => chosen(g.id).map((oid) => ({ group_id: g.id, option_id: oid })));
    onAdd(product.id, quantity, modifiers, notes.trim() || undefined);
  };

  return (
    <Modal open onClose={onClose} title={product.display_name}>
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
        <div className="text-sm text-muted">Base {symbol}{product.unit_price.toFixed(2)} per unit.</div>
        {isLoading ? (
          <div className="card p-4 animate-pulse h-16" />
        ) : groupList.length === 0 ? (
          <p className="text-sm text-muted">No modifiers for this item — add it straight away.</p>
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
                {g.options.filter((o) => o.is_active).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(g.id, o.id)}
                    aria-pressed={chosen(g.id).includes(o.id)}
                    className={`btn px-3 py-1.5 text-sm ${chosen(g.id).includes(o.id) ? "btn-primary" : "btn-secondary"}`}
                  >
                    {o.name} {o.price_delta !== 0 && <span className="text-xs tabular-nums">({o.price_delta > 0 ? "+" : "-"}{symbol}{Math.abs(o.price_delta).toFixed(2)})</span>}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="mod-qty" className="text-sm text-muted">Qty</label>
            <input id="mod-qty" className="input w-20" type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div className="text-right">
            <div className="text-sm text-muted">Line total</div>
            <div className="font-semibold text-ink tabular-nums">{symbol}{lineTotal.toFixed(2)}</div>
          </div>
        </div>
      <label className="block text-sm font-medium text-ink mb-1" htmlFor="mod-notes">Note to kitchen (optional)</label>
          <textarea
            id="mod-notes"
            className="input min-h-[64px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. no onions, well done..."
            maxLength={500}
          />
        </div>
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleAdd} className="btn-primary flex items-center gap-1.5">
          <Plus size={16} /> Add to Order
        </button>
      </div>
    </Modal>
  );
}

function EditTicketModal({ open, ticket, onClose, onSave }: {
  open: boolean;
  ticket: RestaurantTicket;
  onClose: () => void;
  onSave: (fields: { customer_name: string; guest_count: number; notes: string }) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setCustomerName(ticket.customer_name || "");
      setGuestCount(ticket.guest_count);
      setNotes(ticket.notes || "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ customer_name: customerName.trim(), guest_count: guestCount, notes: notes.trim() });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${ticket.ticket_number}`}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="edit-customer">Customer / booking name</label>
          <input id="edit-customer" className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" maxLength={120} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="edit-guests">Guest count</label>
          <input id="edit-guests" className="input w-32" type="number" min={1} max={99} value={guestCount} onChange={(e) => setGuestCount(Math.max(1, parseInt(e.target.value) || 1))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="edit-notes">Notes (allergies, requests)</label>
          <textarea id="edit-notes" className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary">Save Changes</button>
        </div>
      </form>
    </Modal>
  );
}

function SettleModal({ open, ticket, onClose, onSettled }: {
  open: boolean;
  ticket: RestaurantTicket;
  onClose: () => void;
  onSettled: (updated: RestaurantTicket, methodLabel: string) => void;
}) {
  const [method, setMethod] = useState("cash");
  const [provider, setProvider] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [tip, setTip] = useState("");
  const [tendered, setTendered] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const fmt = (n: number) => `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    if (open) {
      setMethod("cash");
      setProvider(null);
      setPhone("");
      setDiscount(ticket.discount_amount > 0 ? String(ticket.discount_amount) : "");
      setTip("");
      setTendered("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const discountValue = parseFloat(discount) || 0;
  const cappedDiscount = Math.min(discountValue, ticket.subtotal);
  const taxRate = settings?.tax_rate ?? 0;
  const taxable = Math.max(ticket.subtotal - cappedDiscount, 0);
  const total = Math.round((taxable + (taxable * taxRate) / 100) * 100) / 100;
  const tipValue = parseFloat(tip) || 0;
  const due = total + tipValue;
  const tenderValue = parseFloat(tendered) || 0;
  const isCash = method === "cash";
  const change = isCash && tenderValue >= due ? tenderValue - due : 0;
  const short = isCash && tenderValue > 0 && tenderValue < due ? due - tenderValue : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (discountValue > ticket.subtotal) {
      addToast("Discount cannot exceed the ticket subtotal", "error");
      return;
    }
    if (isCash && tenderValue < due) {
      addToast(`Tendered value is short by ${fmt(short)}`, "error");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { payment_method: method };
      if (method === "mobile_money") {
        payload.payment_provider = provider;
        payload.payment_phone = phone.trim();
      }
      if (cappedDiscount > 0) payload.discount_amount = cappedDiscount;
      if (tipValue > 0) payload.tip_amount = tipValue;
      const { data } = await api.post(`/restaurant/tickets/${ticket.id}/settle`, payload);
      const updated = data as RestaurantTicket;
      const methodLabel = paymentLabel(method, provider);

      if (updated.status === "paying" && method === "mobile_money" && phone.trim() && updated.sale_id) {
        const stk = await api.post("/daraja/stk-push", {
          phone: phone.trim(),
          amount: Number(updated.total_amount),
          reference: updated.ticket_number,
          description: `Payment for ${updated.ticket_number}`,
          account_ref: updated.ticket_number,
        }).catch(() => null);
        if (stk?.data?.success) {
          api.put(`/sales/${updated.sale_id}/checkout-id`, { checkout_request_id: stk.data.checkout_request_id }).catch(() => {});
        } else {
          addToast("Sale created — please push the STK request from the Sales page", "info");
        }
      }
      onSettled(updated, methodLabel);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Cannot settle ticket"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Settle ${ticket.ticket_number}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="settle-method">Payment method</label>
          <PaymentMethodPicker
            method={method}
            provider={provider}
            onSelect={(m, p) => { setMethod(m); setProvider(p); }}
            ariaLabel="Payment method"
          />
        </div>
        {method === "mobile_money" && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="settle-phone">Phone number *</label>
            <input
              id="settle-phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
              required
              inputMode="tel"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="settle-discount">Discount ({symbol})</label>
          <input
            id="settle-discount"
            className="input"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0.00"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="settle-tip">Tip ({symbol})</label>
          <input
            id="settle-tip"
            className="input"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            placeholder="0.00"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
          />
        </div>
        {isCash && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="settle-tendered">Cash tendered ({symbol})</label>
            <input
              id="settle-tendered"
              className="input"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              placeholder="0.00"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
            />
          </div>
        )}
        <div className="border-t border-border pt-3 space-y-1.5">
          <div className="flex justify-between text-muted">
            <span>Total to collect</span>
            <span className="tabular-nums">{fmt(total)}</span>
          </div>
          {tipValue > 0 && (
            <div className="flex justify-between text-muted">
              <span>Tip</span>
              <span className="tabular-nums">{fmt(tipValue)}</span>
            </div>
          )}
          {isCash && tenderValue > 0 && (
            <div className={`flex justify-between font-medium ${short > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              <span>{short > 0 ? "Short" : "Change due"}</span>
              <span className="tabular-nums">{fmt(short > 0 ? short : change)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-ink pt-1">
            <span>{isCash ? "Cash to collect" : "Total to collect"}</span>
            <span className="tabular-nums">{fmt(due)}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || (method === "mobile_money" && !phone.trim())} className="btn-primary">
            {saving ? "Settling..." : method === "mobile_money" ? "Collect Payment" : "Settle Now"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VoidItemModal({ open, item, onClose, onConfirm }: {
  open: boolean;
  item: RestaurantTicketItem | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const { addToast } = useToast();

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    if (item.status !== "pending" && !reason.trim()) {
      addToast("A reason is required when voiding an item sent to the kitchen", "error");
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <Modal open={open} onClose={onClose} title="Void Item">
      {item && (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
              <Ban size={18} />
            </div>
            <div>
              <div className="font-medium text-ink">{item.product_name}</div>
              <div className="text-xs text-muted">×{item.quantity} · {item.status === "pending" ? "not yet sent" : `already sent to kitchen (${item.status})`}</div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="void-reason">
              Reason {item.status === "pending" ? "(optional)" : "*"}
            </label>
            <textarea
              id="void-reason"
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer changed mind, overcooked..."
              maxLength={200}
            />
            <p className="text-xs text-muted mt-1">{item.status === "pending" ? "Pending items haven't used stock — no stock will be returned." : "Stock will be returned to the kitchen inventory."}</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-danger flex items-center gap-1.5">
              <Ban size={16} /> Void Item
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SplitBillModal({ open, ticket, onClose, onSplit }: {
  open: boolean;
  ticket: RestaurantTicket;
  onClose: () => void;
  onSplit: (payload: { itemIds: number[]; tableId?: number | null; guestCount?: number | null; customerName?: string; notes?: string }) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [guestCount, setGuestCount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const { data: settings } = useSettings();
  const { addToast } = useToast();
  const symbol = settings?.currency_symbol ?? "$";

  useEffect(() => {
    if (open) {
      setSelected([]);
      setTableId(null);
      setGuestCount("");
      setCustomerName("");
      setNotes("");
    }
  }, [open]);

  const active = ticket.items.filter((i) => i.status !== "voided");
  const allChecked = selected.length > 0 && selected.length === active.length;
  const toMoveAmount = active.filter((i) => selected.includes(i.id)).reduce((sum, i) => sum + (i.line_total ?? i.unit_price * i.quantity), 0);
  const keepAmount = active.reduce((sum, i) => sum + (i.line_total ?? i.unit_price * i.quantity), 0) - toMoveAmount;

  const toggle = (id: number) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };
  const toggleAll = () => {
    if (allChecked) setSelected([]);
    else setSelected(active.map((i) => i.id));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) {
      addToast("Select at least one item to move to the new bill", "error");
      return;
    }
    if (selected.length === active.length) {
      addToast("Keep at least one item on the original bill", "error");
      return;
    }
    onSplit({
      itemIds: selected,
      tableId,
      guestCount: guestCount ? Number(guestCount) : null,
      customerName: customerName.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Split ${ticket.ticket_number}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Move selected items to a new bill. Stock already sent to the kitchen stays attributed to the original ticket.</p>
        {active.length === 0 && (
          <p className="text-sm text-red-600 dark:text-red-400">Nothing to split — this ticket has no active items.</p>
        )}
        {active.length > 1 && (
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={toggleAll} className="btn-secondary text-xs px-3 py-1.5">
              {allChecked ? "Clear all" : "Select all"}
            </button>
            <span className="text-xs text-muted">{selected.length} to move</span>
          </div>
        )}
        <ul className="divide-y divide-border border border-border rounded-lg max-h-[280px] overflow-y-auto">
          {active.map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-app transition">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  className="accent-primary-strong"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink text-sm truncate">{item.product_name}</div>
                  <div className="text-xs text-muted">×{item.quantity} · {symbol}{item.unit_price.toFixed(2)}</div>
                </div>
                <span className="text-sm tabular-nums text-muted">{symbol}{(item.line_total ?? item.unit_price * item.quantity).toFixed(2)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="split-guests">Guest count (optional)</label>
            <input
              id="split-guests"
              className="input"
              type="number"
              min={1}
              max={99}
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
              placeholder={String(ticket.guest_count)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="split-customer">Customer / booking name</label>
            <input
              id="split-customer"
              className="input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={ticket.customer_name || "Walk-in"}
              maxLength={120}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="split-notes">Notes (optional)</label>
          <input
            id="split-notes"
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Split of [ticket]"
            maxLength={2000}
          />
        </div>
        <div className="border-t border-border pt-3 space-y-1.5 text-sm">
          <div className="flex justify-between text-muted"><span>Moving to new bill</span><span className="tabular-nums">{symbol}{toMoveAmount.toFixed(2)}</span></div>
          <div className="flex justify-between text-muted"><span>Staying on this bill</span><span className="tabular-nums">{symbol}{keepAmount.toFixed(2)}</span></div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={active.length === 0 || selected.length === 0} className="btn-primary flex items-center gap-1.5">
            <Scissors size={16} /> Split Bill
          </button>
        </div>
      </form>
    </Modal>
  );
}