import { Link } from "react-router-dom";
import { ArrowRight, ReceiptText } from "lucide-react";
import type { RestaurantTicket } from "../../types";
import RestaurantSlideOver from "./RestaurantSlideOver";
import { formatDateTime } from "../../utils/date";
import { useSettings } from "../../hooks/useSettings";
import { formatCurrency } from "../../utils/currency";

const STATUS_BADGE: Record<string, string> = {
  open: "badge-neutral",
  preparing: "badge-info",
  ready: "badge-warning",
  served: "badge-info",
  paying: "badge-warning",
  settled: "badge-success",
  cancelled: "badge-danger",
};

const ITEM_STATUS_BADGE: Record<string, string> = {
  pending: "badge-neutral",
  queued: "badge-info",
  preparing: "badge-warning",
  ready: "badge-success",
  served: "badge-info",
  voided: "badge-danger",
};

interface Props {
  ticket: RestaurantTicket | null;
  onClose: () => void;
}

export default function RestaurantTicketDetailDrawer({ ticket, onClose }: Props) {
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";

  if (!ticket) return null;
  const t = ticket;

  const money = (n: number) => formatCurrency(n, symbol);

  return (
    <RestaurantSlideOver
      open
      onClose={onClose}
      title={t.ticket_number}
      breadcrumb={`Ticket ${t.ticket_number}`}
      actions={
        <span className={`badge ${STATUS_BADGE[t.status] ?? "badge-neutral"}`}>{t.status}</span>
      }
      footer={
        <Link to={`/restaurant/tickets/${t.id}`} className="btn-primary w-full flex items-center justify-center gap-1.5">
          Open full ticket <ArrowRight size={16} />
        </Link>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Table</dt>
            <dd className="text-ink font-medium mt-0.5">{t.table_number || "Takeaway"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Guest</dt>
            <dd className="text-ink font-medium mt-0.5">{t.customer_name || "Walk-in"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Opened</dt>
            <dd className="text-ink font-medium mt-0.5">{formatDateTime(t.opened_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Items</dt>
            <dd className="text-ink font-medium mt-0.5">{t.items.length}</dd>
          </div>
        </dl>

        {t.split_parent_number && (
          <div className="card p-3 text-xs text-muted">
            Split from {t.split_parent_number} — this is a partial check.
          </div>
        )}

        {t.items.length === 0 ? (
          <div className="card p-4 text-sm text-muted text-center">No items on this ticket.</div>
        ) : (
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Items</h3>
            <ul className="divide-y divide-border card p-0 overflow-hidden">
              {t.items.map((item) => (
                <li key={item.id} className={`px-4 py-3 flex items-start justify-between gap-3 ${item.status === "voided" ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <div className={`font-medium text-ink ${item.status === "voided" ? "line-through" : ""}`}>
                      {item.quantity} × {item.product_name}
                    </div>
                    {item.modifiers?.length ? (
                      <div className="text-xs text-muted mt-0.5">{item.modifiers.map((m) => `+${m.name}`).join(" · ")}</div>
                    ) : null}
                    <span className={`badge ${ITEM_STATUS_BADGE[item.status] ?? "badge-neutral"} text-[10px] mt-1`}>{item.status}</span>
                    {item.void_reason && <div className="text-xs text-red-500 mt-0.5">Void: {item.void_reason}</div>}
                  </div>
                  <div className="text-sm font-medium tabular-nums shrink-0">{money(item.line_total ?? item.unit_price * item.quantity)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card p-4 space-y-2 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <span className="tabular-nums">{money(t.subtotal)}</span>
          </div>
          {t.discount_amount > 0 && (
            <div className="flex justify-between text-muted">
              <span>Discount</span>
              <span className="tabular-nums">−{money(t.discount_amount)}</span>
            </div>
          )}
          <div className="flex justify-between text-muted">
            <span>Tax</span>
            <span className="tabular-nums">{money(t.tax_amount)}</span>
          </div>
          {t.tip_amount > 0 && (
            <div className="flex justify-between text-muted">
              <span>Tip</span>
              <span className="tabular-nums">{money(t.tip_amount)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-ink border-t border-border pt-2">
            <span>Total</span>
            <span className="tabular-nums">{money(t.total_amount)}</span>
          </div>
        </div>

        {t.notes && (
          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              <ReceiptText size={13} /> Notes
            </div>
            <p className="text-sm text-ink whitespace-pre-wrap">{t.notes}</p>
          </div>
        )}
      </div>
    </RestaurantSlideOver>
  );
}