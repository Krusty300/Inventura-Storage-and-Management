import { useNavigate } from "react-router-dom";
import { CookingPot, Users } from "lucide-react";
import type { RestaurantReservation, RestaurantTable } from "../../types";
import SlideOver from "../SlideOver";
import { PanelCard, PanelDetailItem, PanelFooter, PanelHeader, PanelSection } from "../Panel";
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
    <SlideOver
      open
      onClose={onClose}
      title={`Table ${t.number}`}
      breadcrumb={`Table ${t.number}`}
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Table"
          title={`Table ${t.number}`}
          actions={
            <span className={`badge ${t.status === "occupied" ? "badge-warning" : "badge-success"}`}>
              {t.status === "occupied" ? "Occupied" : "Free"}
            </span>
          }
        />

        <PanelSection label="Table Details">
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <PanelDetailItem label="Zone">{t.zone || "Main"}</PanelDetailItem>
            <PanelDetailItem label="Seats">{t.capacity}</PanelDetailItem>
          </dl>
        </PanelSection>

        <PanelSection label="Reservations" last={upcoming.length === 0}>
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
        </PanelSection>

        <PanelFooter>
          {t.status === "occupied" && t.active_ticket_id ? (
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
          ) : null}
        </PanelFooter>
      </PanelCard>
    </SlideOver>
  );
}