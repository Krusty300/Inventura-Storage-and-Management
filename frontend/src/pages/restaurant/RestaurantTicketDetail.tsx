import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  UtensilsCrossed, Search, Plus, Minus, Trash2, Send, ChefHat, CheckCheck,
  StickyNote, Ban, Scissors, Info, X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type {
  Customer, MenuItem, MenuModifierGroup, MenuSectionWithItems, Product, RestaurantTicket, RestaurantTicketItem,
} from "../../types";
import EmptyState from "../../components/EmptyState";
import ScrollArea from "../../components/ScrollArea";
import TextArea from "../../components/TextArea";
import ConfirmDialog from "../../components/ConfirmDialog";
import CustomerPicker from "../../components/CustomerPicker";
import PaymentMethodPicker from "../../components/PaymentMethodPicker";
import BarcodeScanner from "../../components/BarcodeScanner";
import RestaurantMenuProductDetail from "../../components/restaurant/RestaurantMenuProductDetail";
import SlideOver from "../../components/SlideOver";
import {
  PanelCard,
  PanelFooter,
  PanelField,
  PanelHeader,
  PanelSection,
  panelLabel,
} from "../../components/Panel";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useSettings } from "../../hooks/useSettings";
import { formatDateTime } from "../../utils/date";
import { paymentLabel } from "../../utils/payments";
import { errorMessage } from "../../utils/errors";
import { formatCurrency } from "../../utils/currency";
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

// Mirrors MAX_DISCOUNT_PERCENT in backend/app/routers/restaurant.py. The server
// enforces the cap; this only keeps the form and its hint honest.
const MAX_DISCOUNT_PERCENT = 50;

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
  const taxRate = settings?.tax_rate ?? 0;

  const [menuSearch, setMenuSearch] = useState("");
  const [activeSection, setActiveSection] = useState("all");
  const [showSettle, setShowSettle] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editTicket, setEditTicket] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<MenuItem | null>(null);
  const [menuProductDetail, setMenuProductDetail] = useState<MenuItem | null>(null);
  const [voidItem, setVoidItem] = useState<RestaurantTicketItem | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const { menu: menuBlocks = [], sections: menuSections = [] } = useMenuData(menuSearch);

  // An uncategorised block has a null id, so sections are keyed by id when there
  // is one and by name otherwise; keying on id alone would make that block
  // collide with the "all" selection.
  const sectionKey = (block: { id: number | null; name: string }) =>
    block.id != null ? `id-${block.id}` : `name-${block.name}`;

  const visibleBlocks = useMemo(
    () => (activeSection === "all"
      ? menuBlocks
      : menuBlocks.filter((b) => sectionKey(b) === activeSection)),
    [menuBlocks, activeSection],
  );

  // A search can leave the selected section empty, which would show a blank
  // pane with no obvious way back. Fall back to the full list when that happens.
  useEffect(() => {
    if (activeSection === "all") return;
    if (!menuBlocks.some((b) => sectionKey(b) === activeSection)) setActiveSection("all");
  }, [menuBlocks, activeSection]);

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
    mutationFn: async (fields: { customer_name?: string; customer_phone?: string; guest_count?: number; notes?: string }) => {
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

  // How many of each dish is already on the open ticket, so a tile can show
  // that at a glance and a waiter can see the running order while browsing.
  const orderCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of pendingItems) {
      counts.set(item.product_id, (counts.get(item.product_id) ?? 0) + item.quantity);
    }
    return counts;
  }, [pendingItems]);
  const pendingCount = pendingItems.reduce((sum, i) => sum + i.quantity, 0);

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
          <button onClick={() => printPdf(`/restaurant/tickets/${ticketId}/bill`)} className="btn-secondary" aria-label={`Print bill for ${ticket.ticket_number}`}>
            Print Bill
          </button>
          {can("restaurant.kitchen") && (
            <button onClick={() => printPdf(`/restaurant/tickets/${ticketId}/kitchen`)} className="btn-secondary" aria-label={`Print kitchen ticket for ${ticket.ticket_number}`}>
              Print Kitchen
            </button>
          )}
          {canEdit && can("restaurant.update") && (
            <>
              <button onClick={() => setShowSplit(true)} className="btn-secondary" aria-label={`Split ${ticket.ticket_number}`}>
                Split Bill
              </button>
              <button onClick={() => setEditTicket(true)} className="btn-secondary" aria-label={`Edit ${ticket.ticket_number}`}>
                Edit Ticket
              </button>
              <button onClick={() => { setConfirmCancel(true); }} className="btn-secondary" aria-label={`Cancel ${ticket.ticket_number}`}>
                Cancel Ticket
              </button>
            </>
          )}
          {canEdit && can("restaurant.settle") && (
            <button onClick={() => setShowSettle(true)} className="btn-primary">
              Pay : {formatCurrency(ticket.total_amount, symbol)}
            </button>
          )}
        </div>
      </div>

      {canEdit && ticket.status === "open" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_400px] items-start">
          <section className="card p-0 overflow-hidden flex flex-col min-w-0" aria-label="Menu">
            <div className="p-4 border-b border-border space-y-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                <input
                  className="input pl-10"
                  placeholder="Search the menu by name or SKU..."
                  value={menuSearch}
                  onChange={(e) => { setMenuSearch(e.target.value); setActiveSection("all"); }}
                  aria-label="Search menu"
                />
                {menuSearch && (
                  <button
                    type="button"
                    onClick={() => { setMenuSearch(""); setActiveSection("all"); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-faint hover:text-ink"
                    aria-label="Clear menu search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <BarcodeScanner onProductFound={onBarcode} placeholder="Scan barcode..." />
            </div>

            {menuSections.length > 1 && (
              <div className="px-4 py-3 border-b border-border overflow-x-auto">
                <div className="flex items-center gap-2 w-max" role="tablist" aria-label="Menu sections">
                  <SectionPill
                    label="All"
                    count={menuBlocks.reduce((sum, b) => sum + b.items.length, 0)}
                    active={activeSection === "all"}
                    onClick={() => setActiveSection("all")}
                  />
                  {menuSections.map((s) => (
                    <SectionPill
                      key={sectionKey(s)}
                      label={s.name}
                      count={s.items.length}
                      active={activeSection === sectionKey(s)}
                      onClick={() => setActiveSection(sectionKey(s))}
                    />
                  ))}
                </div>
              </div>
            )}

            <ScrollArea viewportClassName="max-h-[calc(100vh-20rem)] p-4 sa-viewport-contain">
              {visibleBlocks.length === 0 ? (
                <EmptyState
                  variant="block"
                  icon={<ChefHat size={48} />}
                  title={menuSearch.trim() ? "No menu items found" : "No menu items yet"}
                  message={menuSearch.trim() ? "Try a different search." : "Mark products as menu items in the product form so they appear here."}
                />
              ) : activeSection === "all" && visibleBlocks.length > 1 ? (
                <div className="space-y-5">
                  {visibleBlocks.map((block) => (
                    <div key={sectionKey(block)}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{block.name}</h3>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                        {block.items.map((p) => (
                          <ProductTile
                            key={p.id}
                            product={p}
                            symbol={symbol}
                            inOrder={orderCounts.get(p.id) ?? 0}
                            onAdd={() => setModifierProduct(p)}
                            onDetail={() => setMenuProductDetail(p)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {visibleBlocks.flatMap((block) => block.items).map((p) => (
                    <ProductTile
                      key={p.id}
                      product={p}
                      symbol={symbol}
                      inOrder={orderCounts.get(p.id) ?? 0}
                      onAdd={() => setModifierProduct(p)}
                      onDetail={() => setMenuProductDetail(p)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </section>

          <section className="card p-5 flex flex-col gap-4 lg:sticky lg:top-4" aria-label="Ticket order">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Ticket Order</h2>
              {pendingItems.length > 0 && (
                <span className="badge badge-neutral tabular-nums">
                  {`${pendingCount} item${pendingCount === 1 ? "" : "s"}`}
                </span>
              )}
            </div>
            {pendingItems.length === 0 ? (
              <EmptyState compact icon={<Plus size={20} />} title="No items yet" message="Tap menu items to build this order." />
            ) : (
              <ScrollArea viewportClassName="max-h-[calc(100vh-26rem)] sa-viewport-contain">
                <ul className="divide-y divide-border -mx-1 px-1">
                  {pendingItems.map((item) => (
                    <li key={item.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <img
                          src={item.product_image || getPlaceholder()}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-lg object-cover bg-app border border-border"
                          loading="lazy"
                          decoding="async"
                          onError={onImageError}
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-ink">{item.product_name}</div>
                          {item.sku && <div className="text-xs text-faint mt-0.5">SKU {item.sku}</div>}
                          {item.modifiers?.length ? (
                            <div className="text-xs text-muted mt-0.5">{item.modifiers.map((m) => `+${m.name}`).join(" · ")}</div>
                          ) : null}
                          {item.notes ? (
                            <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
                              <StickyNote size={12} className="mt-0.5 shrink-0" />
                              <span className="min-w-0 break-words">{item.notes}</span>
                            </div>
                          ) : null}
                          <div className="text-xs text-muted mt-0.5">
                            {formatCurrency(item.unit_price, symbol)} × {item.quantity} ={" "}
                            <span className="font-semibold text-ink tabular-nums">
                              {formatCurrency(item.line_total ?? item.unit_price * item.quantity, symbol)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {can("restaurant.update") ? (
                        <QuantityStepper
                          quantity={item.quantity}
                          name={item.product_name}
                          disabled={updateItem.isPending}
                          onChange={(quantity) => updateItem.mutate({ itemId: item.id, quantity })}
                          onRemove={() => removeItem.mutate(item.id)}
                          onVoid={() => setVoidItem(item)}
                        />
                      ) : (
                        <span className="text-sm tabular-nums shrink-0">×{item.quantity}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
            <div className="mt-auto pt-3 space-y-1 text-sm border-t border-border">
              <div className="flex justify-between text-muted"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(ticket.subtotal, symbol)}</span></div>
              {ticket.discount_amount > 0 && <div className="flex justify-between text-muted"><span>Discount</span><span className="tabular-nums">-{formatCurrency(ticket.discount_amount, symbol)}</span></div>}
              {ticket.tax_amount > 0 && <div className="flex justify-between text-muted"><span>Tax ({taxRate}%)</span><span className="tabular-nums">{formatCurrency(ticket.tax_amount, symbol)}</span></div>}
              {ticket.tip_amount > 0 && <div className="flex justify-between text-muted"><span>Tip</span><span className="tabular-nums">{formatCurrency(ticket.tip_amount, symbol)}</span></div>}
              <div className="flex justify-between items-baseline font-bold text-ink pt-1.5 mt-1 border-t border-border/60">
                <span className="text-base">Total</span>
                <span className="text-2xl tabular-nums">{formatCurrency(ticket.total_amount, symbol)}</span>
              </div>
            </div>
            {can("restaurant.create") && pendingItems.length > 0 && (
              <button onClick={() => sendToKitchen.mutate()} disabled={sendToKitchen.isPending} className="btn-primary w-full h-12 flex items-center justify-center gap-1.5">
                <Send size={16} /> {sendToKitchen.isPending ? "Sending…" : "Send to Kitchen"}
              </button>
            )}
          </section>
        </div>
      )}

      {canEdit && ticket.status !== "open" && (
        <div className="card p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-semibold text-ink">Kitchen</h2>
            {ticket.items.some((i) => i.status === "ready") && can("restaurant.update") && (
              <button onClick={() => serve.mutate()} disabled={serve.isPending} className="btn-secondary flex items-center gap-1.5">
                <CheckCheck size={16} /> {serve.isPending ? "Marking served…" : "Mark Served"}
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
                  {item.notes ? (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
                      <StickyNote size={12} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 break-words">{item.notes}</span>
                    </div>
                  ) : null}
                  <div className="text-xs text-muted mt-0.5">×{item.quantity} · {formatCurrency(item.unit_price, symbol)}</div>
                  {item.status === "voided" && item.void_reason && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                      Voided: {item.void_reason}
                      {item.voided_by_username ? ` — ${item.voided_by_username}` : ""}
                    </div>
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
                        <button onClick={() => setVoidItem(item)} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600 dark:hover:text-red-400" aria-label={`Void ${item.product_name}`}>
                          <Ban size={16} />
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
          <p className="text-sm text-muted mt-1">Settled {formatDateTime(ticket.settled_at)} for {formatCurrency(ticket.total_amount, symbol)}{ticket.tip_amount > 0 && ` plus a ${formatCurrency(ticket.tip_amount, symbol)} tip`}.</p>
        </div>
      )}

      {ticket.status === "paying" && (
        <div className="card p-5 text-center">
          <h2 className="text-lg font-bold text-ink">Awaiting mobile money confirmation</h2>
          <p className="text-sm text-muted mt-1">The ticket settles automatically once the STK payment is confirmed.</p>
        </div>
      )}

      {ticket.status === "cancelled" && (
        <div className="card p-5 text-center">
          <Ban size={32} className="mx-auto mb-3 text-red-600 dark:text-red-400" />
          <h2 className="text-lg font-bold text-ink">Ticket cancelled</h2>
          <p className="text-sm text-muted mt-1">This ticket was cancelled and can no longer be modified or served.</p>
        </div>
      )}

      <VoidItemSlideOver
        open={voidItem !== null}
        item={voidItem}
        onClose={() => setVoidItem(null)}
        onConfirm={(reason) => {
          if (!voidItem) return;
          voidItemMutation.mutate({ itemId: voidItem.id, reason });
          setVoidItem(null);
        }}
      />

      <SplitBillSlideOver
        open={showSplit}
        ticket={ticket}
        onClose={() => setShowSplit(false)}
        onSplit={(payload) => {
          setShowSplit(false);
          splitTicket.mutate(payload);
        }}
      />

      <SettleSlideOver
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
        <ModifierSlideOver
          product={modifierProduct}
          symbol={symbol}
          isPending={addItem.isPending}
          onClose={() => setModifierProduct(null)}
          onAdd={(productId, quantity, modifiers, notes) => {
            if (addItem.isPending) return;
            addItem.mutate({ productId, quantity, modifiers, notes });
            setModifierProduct(null);
            addToast("Item added to order", "success");
          }}
        />
      )}

      <RestaurantMenuProductDetail
        menuItem={menuProductDetail}
        onClose={() => setMenuProductDetail(null)}
      />

      <EditTicketSlideOver
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

/**
 * Order-line controls for an unsent dish. The quantity is a real input rather
 * than a read-only number, so a waiter can type "6" for a table of six instead
 * of tapping plus five times - the same affordance the register cart offers.
 * Removing a pending line deletes it outright; once a line has been sent the
 * kitchen owns it and the change has to be voided for the audit trail instead.
 */
function QuantityStepper({ quantity, name, disabled, onChange, onRemove, onVoid }: {
  quantity: number;
  name: string;
  disabled?: boolean;
  onChange: (quantity: number) => void;
  onRemove: () => void;
  onVoid: () => void;
}) {
  const [draft, setDraft] = useState(String(quantity));

  // The server is the source of truth once the mutation lands, so snap the
  // field back whenever a fresh quantity arrives from the ticket.
  useEffect(() => {
    setDraft(String(quantity));
  }, [quantity]);

  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      setDraft(String(quantity));
      return;
    }
    if (parsed !== quantity) onChange(parsed);
    else setDraft(String(quantity));
  };

  return (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
      <div className="flex items-center rounded-lg border border-border overflow-hidden shrink-0">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, quantity - 1))}
          disabled={disabled || quantity <= 1}
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center text-muted hover:bg-app disabled:opacity-40"
          aria-label={`Decrease ${name}`}
        >
          <Minus size={16} />
        </button>
        <input
          type="number"
          className="w-12 text-center input !rounded-none !border-0 text-sm"
          value={draft}
          min={1}
          max={99}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          aria-label={`Quantity for ${name}`}
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(99, quantity + 1))}
          disabled={disabled}
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center text-muted hover:bg-app disabled:opacity-40"
          aria-label={`Increase ${name}`}
        >
          <Plus size={16} />
        </button>
      </div>
      <button onClick={onRemove} disabled={disabled} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40" aria-label={`Remove ${name}`}>
        <Trash2 size={16} />
      </button>
      <button onClick={onVoid} disabled={disabled} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40" aria-label={`Void ${name}`}>
        <Ban size={16} />
      </button>
    </div>
  );
}

function SectionPill({ label, count, active, onClick }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-primary text-white"
          : "bg-app text-muted hover:text-ink"
      }`}
    >
      {label}
      <span className={`text-xs tabular-nums ${active ? "text-white/80" : "text-faint"}`}>{count}</span>
    </button>
  );
}

/**
 * Dish card for the POS pane. Mirrors the SaleForm product grid: photo first,
 * then name, SKU and a bold price, so a server scanning the menu recognises
 * dishes by sight instead of reading a list of names.
 */
function ProductTile({ product, symbol, inOrder, onAdd, onDetail }: {
  product: MenuItem;
  symbol: string;
  inOrder: number;
  onAdd: () => void;
  onDetail: () => void;
}) {
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-surface text-left transition-colors hover:border-primary hover:shadow-sm ${
        product.available ? "border-border" : "border-border/60 opacity-70"
      }`}
    >
      <button
        type="button"
        onClick={onAdd}
        disabled={!product.available}
        className="flex flex-1 flex-col p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed"
        aria-label={`Add ${product.display_name} to order`}
      >
        <div className="relative mb-2 h-28 w-full overflow-hidden rounded-lg bg-subtle">
          <img
            src={product.image || product.image_url || getPlaceholder()}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={onImageError}
          />
          {inOrder > 0 && (
            <span
              className="absolute right-1.5 top-1.5 min-w-[1.5rem] rounded-full bg-primary px-1.5 py-0.5 text-center text-xs font-semibold text-white tabular-nums shadow-sm"
              aria-label={`${inOrder} in order`}
            >
              {inOrder}
            </span>
          )}
          {!product.available && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-ink/80 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
              Unavailable
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-sm font-semibold text-ink">{product.display_name}</p>
        {product.sku && <p className="mt-0.5 truncate text-xs text-faint">{product.sku}</p>}
        <p className="mt-1.5 text-sm font-bold text-primary dark:text-primary tabular-nums">
          {formatCurrency(product.unit_price, symbol)}
        </p>
      </button>

      <div className="flex items-stretch border-t border-border">
        <button
          type="button"
          onClick={onAdd}
          disabled={!product.available}
          className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:hover:bg-primary/10 disabled:cursor-not-allowed"
        >
          <Plus size={16} />
          Add
        </button>
        <button
          type="button"
          onClick={onDetail}
          className="flex w-10 items-center justify-center border-l border-border text-muted transition-colors hover:bg-app hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          aria-label={`View ${product.display_name} details`}
        >
          <Info size={15} />
        </button>
      </div>
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

  // `menu` (unfiltered) drives the category rail so a section can show how many
  // items it holds, while `blocks` is what the search actually matched.
  return { menu: filtered, sections: menu ?? [] };
}

function ModifierSlideOver({ product, symbol, isPending, onClose, onAdd }: {
  product: MenuItem;
  symbol: string;
  isPending: boolean;
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
    <SlideOver
      open
      onClose={onClose}
      title={product.display_name}
      breadcrumb={`Add ${product.display_name}`}
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Add Item"
          title={product.display_name}
          subtitle={product.sku ? `SKU ${product.sku}` : undefined}
          actions={
            <span className={`badge shrink-0 ${product.available ? "badge-success" : "badge-danger"}`}>
              {product.available ? "Available" : "Out of stock"}
            </span>
          }
        />

        <PanelSection label="Item">
          <div className="flex gap-4">
            <img
              src={product.image || product.image_url || getPlaceholder()}
              alt=""
              className="h-28 w-28 sm:h-32 sm:w-32 shrink-0 rounded-xl object-cover bg-app border border-border"
              loading="lazy"
              decoding="async"
              onError={onImageError}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink tabular-nums">
                {formatCurrency(product.unit_price, symbol)}{" "}
                <span className="font-normal text-muted">per unit</span>
              </div>
              {product.description && (
                <p className="text-sm text-muted mt-2 whitespace-pre-wrap line-clamp-4">{product.description}</p>
              )}
            </div>
          </div>
        </PanelSection>

        <PanelSection label="Modifiers">
          {isLoading ? (
            <div className="card p-4 animate-pulse h-16" />
          ) : groupList.length === 0 ? (
            <p className="text-sm text-muted">No modifiers for this item — add it straight away.</p>
          ) : (
            <div className="space-y-4">
              {groupList.map((g) => (
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
                        className={`btn min-h-10 px-3 py-2 text-sm ${chosen(g.id).includes(o.id) ? "btn-primary" : "btn-secondary"}`}
                      >
                        {o.name} {o.price_delta !== 0 && (
                          <span className="text-xs tabular-nums">
                            ({o.price_delta > 0 ? "+" : "-"}{formatCurrency(Math.abs(o.price_delta), symbol)})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelSection>

        <PanelSection label="Quantity">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">Qty</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-border text-muted hover:text-ink hover:bg-subtle disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Decrease quantity"
                >
                  <Minus size={16} />
                </button>
                <span className="w-10 text-center text-base font-semibold text-ink tabular-nums" aria-label="Quantity">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  disabled={quantity >= 99}
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-border text-muted hover:text-ink hover:bg-subtle disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Increase quantity"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Line total</div>
              <div className="text-lg font-semibold text-ink tabular-nums">{formatCurrency(lineTotal, symbol)}</div>
            </div>
          </div>
          {extras !== 0 && (
            <div className="text-xs text-muted border-t border-border mt-4 pt-3 space-y-1">
              <div className="flex justify-between gap-2">
                <span>Base</span>
                <span className="tabular-nums">{formatCurrency(product.unit_price, symbol)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Modifiers</span>
                <span className="tabular-nums">{extras > 0 ? "+" : "-"}{formatCurrency(Math.abs(extras), symbol)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Unit price</span>
                <span className="tabular-nums">{formatCurrency(unitPrice, symbol)}</span>
              </div>
            </div>
          )}
        </PanelSection>

        <PanelSection label="Kitchen Note">
          <TextArea
            id="mod-notes"
            className="min-h-[64px]"
            value={notes}
            onChange={setNotes}
            placeholder="e.g. no onions, well done..."
            maxLength={500}
          />
        </PanelSection>

        <PanelFooter>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleAdd} disabled={isPending} className="btn-primary flex items-center gap-1.5">
            <Plus size={16} /> {isPending ? "Adding…" : "Add to Order"}
          </button>
        </PanelFooter>
      </PanelCard>
    </SlideOver>
  );
}

function EditTicketSlideOver({ open, ticket, onClose, onSave }: {
  open: boolean;
  ticket: RestaurantTicket;
  onClose: () => void;
  onSave: (fields: { customer_name: string; customer_phone: string; guest_count: number; notes: string }) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setCustomerName(ticket.customer_name || "");
      setCustomerPhone(ticket.customer_phone || "");
      setGuestCount(ticket.guest_count);
      setNotes(ticket.notes || "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      guest_count: guestCount,
      notes: notes.trim(),
    });
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={`Edit ${ticket.ticket_number}`}
      breadcrumb={`Edit ${ticket.ticket_number}`}
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Edit Ticket"
          title={ticket.ticket_number}
          subtitle={customerName || "Walk-in"}
        />
        <form id="edit-ticket-form" onSubmit={submit} className="space-y-0">
          <PanelSection label="Customer">
            <span className={panelLabel}>Customer</span>
            <CustomerPicker
              value={null}
              onChange={() => {}}
              onSelectCustomer={(c) => {
                setCustomerName(c.name);
                setCustomerPhone(c.phone || "");
              }}
              placeholder={customerName ? `Search to change — now ${customerName}` : "Search a customer to attach this bill..."}
            />
            <p className="text-xs text-muted mt-1">Picking a customer fills the booking name and contact phone.</p>
          </PanelSection>

          <PanelSection label="Booking">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PanelField label="Customer / booking name" htmlFor="edit-customer">
                <input id="edit-customer" className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" maxLength={120} />
              </PanelField>
              <PanelField label="Contact phone" htmlFor="edit-customer-phone">
                <input id="edit-customer-phone" className="input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" maxLength={40} />
              </PanelField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <PanelField label="Guest count" htmlFor="edit-guests">
                <input id="edit-guests" className="input w-32" type="number" min={1} max={99} value={guestCount} onChange={(e) => setGuestCount(Math.max(1, parseInt(e.target.value) || 1))} />
              </PanelField>
            </div>
          </PanelSection>

          <PanelSection label="Notes" last>
            <TextArea id="edit-notes" className="min-h-[80px]" value={notes} onChange={setNotes} maxLength={2000} />
          </PanelSection>

          <PanelFooter>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Save Changes</button>
          </PanelFooter>
        </form>
      </PanelCard>
    </SlideOver>
  );
}

function SettleSlideOver({ open, ticket, onClose, onSettled }: {
  open: boolean;
  ticket: RestaurantTicket;
  onClose: () => void;
  onSettled: (updated: RestaurantTicket, methodLabel: string) => void;
}) {
  const [method, setMethod] = useState("cash");
  const [provider, setProvider] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [tip, setTip] = useState("");
  const [tendered, setTendered] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const canDiscount = can("restaurant.discount");

  const lookupName = (ticket.customer_name || "").trim();
  const lookupPhone = (ticket.customer_phone || "").trim();
  const { data: customerMatches } = useQuery({
    queryKey: ["settle-customer-lookup", open, lookupName, lookupPhone],
    queryFn: async () => {
      const q = lookupPhone || lookupName;
      if (!q) return [] as Customer[];
      const { data } = await api.get("/customers", { params: { search: q, limit: 8, skip: 0 } });
      return (data.items ?? []) as Customer[];
    },
    enabled: open && (!!lookupName || !!lookupPhone),
  });

  useEffect(() => {
    if (open) {
      setMethod("cash");
      setProvider(null);
      setPhone("");
      setCustomerId(null);
      setCustomerPhone(ticket.customer_phone || "");
      setDiscount(ticket.discount_amount > 0 ? String(ticket.discount_amount) : "");
      setDiscountReason("");
      setTip("");
      setTendered("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const matches = customerMatches ?? [];
    const name = lookupName.toLowerCase();
    const phoneDigits = (s: string) => (s || "").replace(/\D+/g, "").slice(-9);
    const target = phoneDigits(lookupPhone);
    const match =
      (target && matches.find((c) => phoneDigits(c.phone) === target)) ||
      (name && matches.find((c) => c.name.toLowerCase() === name)) ||
      (matches.length === 1 ? matches[0] : null);
    if (match) setCustomerId(match.id);
  }, [open, customerMatches, lookupName, lookupPhone]);

  const discountValue = parseFloat(discount) || 0;
  const maxDiscount = Math.round(ticket.subtotal * MAX_DISCOUNT_PERCENT) / 100;
  const cappedDiscount = Math.min(discountValue, maxDiscount);
  const taxRate = settings?.tax_rate ?? 0;
  const taxable = Math.max(ticket.subtotal - cappedDiscount, 0);
  const total = Math.round((taxable + (taxable * taxRate) / 100) * 100) / 100;
  const tipValue = parseFloat(tip) || 0;
  const due = total + tipValue;
  const tenderValue = parseFloat(tendered) || 0;
  const isCash = method === "cash";
  // Daraja charges whole units, so show the figure that will actually be
  // prompted rather than a total with stray cents.
  const mpesaAmount = Math.round(due);
  const change = isCash && tenderValue >= due ? tenderValue - due : 0;
  const short = isCash && tenderValue > 0 && tenderValue < due ? due - tenderValue : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (discountValue > maxDiscount) {
      addToast(
        `Discount cannot exceed ${MAX_DISCOUNT_PERCENT}% of the subtotal (${formatCurrency(maxDiscount, symbol)})`,
        "error",
      );
      return;
    }
    if (cappedDiscount > 0 && discountReason.trim().length < 3) {
      addToast("A written reason is required for any discount", "error");
      return;
    }
    if (isCash && tenderValue < due) {
      addToast(`Tendered value is short by ${formatCurrency(short, symbol)}`, "error");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { payment_method: method };
      if (customerId != null) payload.customer_id = customerId;
      if (customerPhone.trim()) payload.customer_phone = customerPhone.trim();
      if (method === "mobile_money") {
        payload.payment_provider = provider;
        payload.payment_phone = phone.trim();
      }
      if (cappedDiscount > 0) {
        payload.discount_amount = cappedDiscount;
        payload.discount_reason = discountReason.trim();
      }
      if (tipValue > 0) payload.tip_amount = tipValue;
      const { data } = await api.post(`/restaurant/tickets/${ticket.id}/settle`, payload);
      const updated = data as RestaurantTicket;
      const methodLabel = paymentLabel(method, provider);

      if (updated.status === "paying" && method === "mobile_money" && phone.trim() && updated.sale_id) {
        // The server pushes the bill plus the recorded tip, so the prompt
        // always matches the figure on the printed receipt.
        const stk = await api.post(`/sales/${updated.sale_id}/stk-push`).catch(() => null);
        if (stk?.data?.success) {
          addToast(`Payment prompt sent for ${formatCurrency(Number(stk.data.amount), symbol)}`, "success");
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
    <SlideOver
      open={open}
      onClose={onClose}
      title={`Settle ${ticket.ticket_number}`}
      breadcrumb={`Settle ${ticket.ticket_number}`}
      wide
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Settle Ticket"
          title={ticket.ticket_number}
          subtitle={ticket.customer_name || "Walk-in"}
        />
        <form id="settle-ticket-form" onSubmit={handleSubmit} className="space-y-0">
          <PanelSection label="Customer">
            <span className={panelLabel}>Customer</span>
            <CustomerPicker
              value={customerId}
              onChange={setCustomerId}
              onSelectCustomer={(c) => {
                setCustomerPhone(c.phone || "");
                if (method === "mobile_money" && !phone.trim()) setPhone(c.phone || "");
              }}
              placeholder={customerPhone ? `Linked contact: ${customerPhone}` : "Search customer to attribute this sale..."}
            />
            <p className="text-xs text-muted mt-1">Attaching a customer records the sale on their account.</p>
            <div className="mt-3">
              <PanelField label="Contact phone" htmlFor="settle-customer-phone">
                <input
                  id="settle-customer-phone"
                  className="input"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="0712 345 678"
                  inputMode="tel"
                  maxLength={40}
                />
              </PanelField>
            </div>
          </PanelSection>

          <PanelSection label="Payment">
            <span className={panelLabel}>Payment method</span>
            <PaymentMethodPicker
              method={method}
              provider={provider}
              onSelect={(m, p) => { setMethod(m); setProvider(p); }}
              ariaLabel="Payment method"
            />
            {method === "mobile_money" && (
              <div className="mt-3">
                <PanelField label="Phone number *" htmlFor="settle-phone">
                  <input
                    id="settle-phone"
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0712 345 678"
                    required
                    inputMode="tel"
                  />
                </PanelField>
              </div>
            )}
          </PanelSection>

          <PanelSection label="Adjustments">
            {canDiscount ? (
              <>
                <PanelField label={`Discount (${symbol})`} htmlFor="settle-discount">
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
                </PanelField>
                <p className="text-xs text-muted mt-1">
                  Up to {MAX_DISCOUNT_PERCENT}% of the subtotal ({formatCurrency(maxDiscount, symbol)}). Discounts are logged and sent to a manager.
                </p>
                {cappedDiscount > 0 && (
                  <div className="mt-3">
                    <PanelField label="Discount reason *" htmlFor="settle-discount-reason">
                      <input
                        id="settle-discount-reason"
                        className="input"
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder="e.g. kitchen error, manager comp, service recovery..."
                        maxLength={200}
                      />
                    </PanelField>
                  </div>
                )}
              </>
            ) : (
              <>
                <span className={panelLabel}>Discount ({symbol})</span>
                <p className="text-sm text-muted">
                  {ticket.discount_amount > 0
                    ? `${formatCurrency(ticket.discount_amount, symbol)} discount already applied to this ticket.`
                    : "Only a manager can apply a discount."}
                </p>
              </>
            )}
            <div className="mt-3">
              <PanelField label={`Tip (${symbol})`} htmlFor="settle-tip">
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
              </PanelField>
            </div>
            {isCash && (
              <div className="mt-3">
                <PanelField label={`Cash tendered (${symbol})`} htmlFor="settle-tendered">
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
                </PanelField>
              </div>
            )}
          </PanelSection>

          <PanelSection label="Summary" last>
            <div className="space-y-1.5">
              <div className="flex justify-between text-muted">
                <span>{tipValue > 0 ? "Bill" : "Total to collect"}</span>
                <span className="tabular-nums">{formatCurrency(total, symbol)}</span>
              </div>
              {tipValue > 0 && (
                <div className="flex justify-between text-muted">
                  <span>Tip</span>
                  <span className="tabular-nums">{formatCurrency(tipValue, symbol)}</span>
                </div>
              )}
              {isCash && tenderValue > 0 && (
                <div className={`flex justify-between font-medium ${short > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  <span>{short > 0 ? "Short" : "Change due"}</span>
                  <span className="tabular-nums">{formatCurrency(short > 0 ? short : change, symbol)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-ink pt-1">
                <span>{isCash ? "Cash to collect" : "M-Pesa prompt"}</span>
                <span className="tabular-nums">{formatCurrency(isCash ? due : mpesaAmount, symbol)}</span>
              </div>
              {!isCash && mpesaAmount !== due && (
                <p className="text-xs text-muted">
                  M-Pesa charges whole units, so the prompt is rounded to {formatCurrency(mpesaAmount, symbol)}.
                </p>
              )}
            </div>
          </PanelSection>

          <PanelFooter>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || (method === "mobile_money" && !phone.trim())} className="btn-primary">
              {saving ? "Settling..." : method === "mobile_money" ? "Collect Payment" : "Settle Now"}
            </button>
          </PanelFooter>
        </form>
      </PanelCard>
    </SlideOver>
  );
}

function VoidItemSlideOver({ open, item, onClose, onConfirm }: {
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
    if (reason.trim().length < 3) {
      addToast("A reason is required to void an item", "error");
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Void Item"
      breadcrumb="Void item"
    >
      {item && (
        <PanelCard>
          <PanelHeader
            eyebrow="Void Item"
            title={item.product_name}
            subtitle={`×${item.quantity} · ${item.status === "pending" ? "not yet sent" : `already sent to kitchen (${item.status})`}`}
          />
          <form id="void-item-form" onSubmit={submit} className="space-y-0">
            <PanelSection label="Reason *">
              <TextArea
                id="void-reason"
                className="min-h-[80px]"
                value={reason}
                onChange={setReason}
                placeholder="e.g. customer changed mind, overcooked, wrong table..."
                maxLength={200}
              />
              <p className="text-xs text-muted mt-1">
                {item.status === "pending" ? "Pending items haven't used stock — no stock will be returned." : "Stock will be returned to the kitchen inventory."} Voids are recorded against your name and sent to a manager.
              </p>
            </PanelSection>
            <PanelFooter>
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-danger flex items-center gap-1.5">
                <Ban size={16} /> Void Item
              </button>
            </PanelFooter>
          </form>
        </PanelCard>
      )}
    </SlideOver>
  );
}

function SplitBillSlideOver({ open, ticket, onClose, onSplit }: {
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
    <SlideOver
      open={open}
      onClose={onClose}
      title={`Split ${ticket.ticket_number}`}
      breadcrumb={`Split ${ticket.ticket_number}`}
      wide
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Split Bill"
          title={ticket.ticket_number}
          subtitle={`${selected.length} of ${active.length} items selected`}
        />
        <form id="split-ticket-form" onSubmit={submit} className="space-y-0">
          <PanelSection label="Items">
            <p className="text-sm text-muted">Move selected items to a new bill. Stock already sent to the kitchen stays attributed to the original ticket.</p>
            {active.length === 0 && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-3">Nothing to split — this ticket has no active items.</p>
            )}
            {active.length > 1 && (
              <div className="flex items-center justify-between gap-2 mt-3">
                <button type="button" onClick={toggleAll} className="btn-secondary text-xs px-3 py-1.5">
                  {allChecked ? "Clear all" : "Select all"}
                </button>
                <span className="text-xs text-muted">{selected.length} to move</span>
              </div>
            )}
            {active.length > 0 && (
              <ul className="divide-y divide-border border border-border rounded-lg max-h-[280px] overflow-y-auto mt-3">
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
                        <div className="text-xs text-muted">×{item.quantity} · {formatCurrency(item.unit_price, symbol)}</div>
                      </div>
                      <span className="text-sm tabular-nums text-muted">
                        {formatCurrency(item.line_total ?? item.unit_price * item.quantity, symbol)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>

          <PanelSection label="New Bill">
            <div className="grid sm:grid-cols-2 gap-4">
              <PanelField label="Guest count (optional)" htmlFor="split-guests">
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
              </PanelField>
              <PanelField label="Customer / booking name" htmlFor="split-customer">
                <input
                  id="split-customer"
                  className="input"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={ticket.customer_name || "Walk-in"}
                  maxLength={120}
                />
              </PanelField>
            </div>
            <div className="mt-4">
              <PanelField label="Notes (optional)" htmlFor="split-notes">
                <input
                  id="split-notes"
                  className="input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Split of [ticket]"
                  maxLength={2000}
                />
              </PanelField>
            </div>
          </PanelSection>

          <PanelSection label="Summary" last>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-muted">
                <span>Moving to new bill</span>
                <span className="tabular-nums">{formatCurrency(toMoveAmount, symbol)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Staying on this bill</span>
                <span className="tabular-nums">{formatCurrency(keepAmount, symbol)}</span>
              </div>
            </div>
          </PanelSection>

          <PanelFooter>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={active.length === 0 || selected.length === 0} className="btn-primary flex items-center gap-1.5">
              <Scissors size={16} /> Split Bill
            </button>
          </PanelFooter>
        </form>
      </PanelCard>
    </SlideOver>
  );
}
