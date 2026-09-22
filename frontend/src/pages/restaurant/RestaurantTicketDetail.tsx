import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  UtensilsCrossed, Search, Plus, Minus, Trash2, Send, ChefHat, CheckCheck,
  Banknote, X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { PaginatedResponse, Product, RestaurantTicket } from "../../types";
import EmptyState from "../../components/EmptyState";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import PaymentMethodPicker from "../../components/PaymentMethodPicker";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useSettings } from "../../hooks/useSettings";
import { useDebounce } from "../../hooks/useDebounce";
import { formatDateTime } from "../../utils/date";
import { paymentLabel } from "../../utils/payments";
import { errorMessage } from "../../utils/errors";

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
  const debouncedMenuSearch = useDebounce(menuSearch, 300);

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

  const { data: menu } = useQuery({
    queryKey: ["menu-products", debouncedMenuSearch],
    queryFn: async () => {
      const params: Record<string, string> = { menu_only: "true", active_only: "true", limit: "100" };
      if (debouncedMenuSearch) params.search = debouncedMenuSearch;
      const { data } = await api.get("/products", { params });
      return data as PaginatedResponse<Product>;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["restaurant-ticket", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-tickets"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
  };

  const addItem = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: number; quantity: number }) => {
      const { data } = await api.post(`/restaurant/tickets/${ticketId}/items`, { product_id: productId, quantity });
      return data;
    },
    onSuccess: () => { invalidate(); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot add item"), "error"),
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

  const menuProducts = useMemo(() => menu?.items ?? [], [menu]);
  const pendingItems = (ticket?.items ?? []).filter((i) => i.status === "pending");
  const canEdit = ticket && !["settled", "cancelled", "paying"].includes(ticket.status);

  const currencyAmount = (n: number) => `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && can("restaurant.update") && (
            <button onClick={() => { setConfirmCancel(true); }} className="btn-secondary" aria-label={`Cancel ${ticket.ticket_number}`}>
              <X size={16} /> Cancel
            </button>
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
            {menuProducts.length === 0 ? (
              <EmptyState
                variant="block"
                icon={<ChefHat size={48} />}
                title={debouncedMenuSearch ? "No menu items found" : "No menu items yet"}
                message={debouncedMenuSearch ? "Try a different search." : "Mark products as menu items in the product form so they appear here."}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {menuProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addItem.mutate({ productId: p.id, quantity: 1 })}
                    className="card p-4 text-left hover:bg-app transition flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
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
                      <div className="text-xs text-muted">{currencyAmount(item.unit_price)} each</div>
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
              <li key={item.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-ink">{item.product_name}</div>
                  <div className="text-xs text-muted">×{item.quantity} · {currencyAmount(item.unit_price)}</div>
                </div>
                <span className={`badge ${item.status === "served" ? "badge-success" : item.status === "ready" ? "badge-warning" : item.status === "preparing" ? "badge-info" : "badge-neutral"}`}>
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ticket.status === "settled" && (
        <div className="card p-5 text-center">
          <CheckCheck size={32} className="mx-auto mb-3 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-ink">Ticket settled</h2>
          <p className="text-sm text-muted mt-1">Settled {formatDateTime(ticket.settled_at)} for {currencyAmount(ticket.total_amount)}.</p>
        </div>
      )}

      {ticket.status === "paying" && (
        <div className="card p-5 text-center">
          <h2 className="text-lg font-bold text-ink">Awaiting mobile money confirmation</h2>
          <p className="text-sm text-muted mt-1">The ticket settles automatically once the STK payment is confirmed.</p>
        </div>
      )}

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
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";

  const discountValue = parseFloat(discount) || 0;
  const total = Math.max(ticket.total_amount - discountValue, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { payment_method: method };
      if (method === "mobile_money") {
        payload.payment_provider = provider;
        payload.payment_phone = phone.trim();
      }
      if (discountValue > 0) payload.discount_amount = discountValue;
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
        <div className="flex justify-between font-semibold text-ink border-t border-border pt-3">
          <span>Total to collect</span>
          <span className="tabular-nums">{symbol}{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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