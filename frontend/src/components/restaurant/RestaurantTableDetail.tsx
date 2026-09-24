import { useNavigate } from "react-router-dom";
import { CalendarClock, CookingPot, Users } from "lucide-react";
import type { RestaurantReservation, RestaurantTable } from "../../types";
import RestaurantSlideOver from "./RestaurantSlideOver";
import { RESERVATION_STATUS_BADGE } from "./reservationStatus";
import { formatDateTime } from "../../utils/date";

interface Props {
  table: RestaurantTable | null;
  reservations: RestaurantReservation[];
  canCreate: boolean;
  onClose: () => void;
  onOpenTicket: (tableId: number) => void;
  onOpenReservation: (r: RestaurantReservation) => void;
}

export default function RestaurantTableDetail({ table, reservations, canCreate, onClose, onOpenTicket, onOpenReservation }: Props) {
  const navigate = useNavigate();
  if (!table) return null;
  const t = table;
  const upcoming = reservations.filter((r) => r.status !== "cancelled" && r.status !== "no_show");

  return (
    <RestaurantSlideOver
      open
      onClose={onClose}
      title={`Table ${t.number}`}
      breadcrumb={`Table ${t.number}`}
      actions={
        <span className={`badge ${t.status === "occupied" ? "badge-warning" : "badge-success"}`}>
          {t.status === "occupied" ? "Occupied" : "Free"}
        </span>
      }
      footer={
        t.status === "occupied" && t.active_ticket_id ? (
          <button
            onClick={() => { navigate(`/restaurant/tickets/${t.active_ticket_id}`); }}
            className="btn-primary w-full flex items-center justify-center gap-1.5"
          >
            <CookingPot size={16} /> Open ticket {t.active_ticket_number}
          </button>
        ) : canCreate ? (
          <button
            onClick={() => { onClose(); onOpenTicket(t.id); }}
            className="btn-primary w-full flex items-center justify-center gap-1.5"
          >
            <CookingPot size={16} /> Open new ticket
          </button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Zone</dt>
            <dd className="text-ink font-medium mt-0.5">{t.zone || "Main"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted uppercase tracking-wide">Seats</dt>
            <dd className="text-ink font-medium mt-0.5">{t.capacity}</dd>
          </div>
        </dl>

        <div>
          <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
            <CalendarClock size={15} className="text-faint" /> Reservations
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">No reservations for this table.</p>
          ) : (
            <ul className="divide-y divide-border card p-0 overflow-hidden">
              {upcoming.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onOpenReservation(r)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-app"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{r.guest_name}</div>
                      <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                        <Users size={11} /> {r.guest_count} · {formatDateTime(r.reserved_at) }
                      </div>
                    </div>
                    <span className={`badge ${RESERVATION_STATUS_BADGE[r.status]} shrink-0`}>{r.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </RestaurantSlideOver>
  );
}