import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantReservation, ReservationStatus } from "../../types";
import SlideOver from "../SlideOver";
import { PanelCard, PanelFooter, PanelHeader, PanelSection, panelSectionLabel } from "../Panel";
import ConfirmDialog from "../ConfirmDialog";
import { RESERVATION_STATUS_BADGE, reservationActions, type ReservationAction } from "./reservationStatus";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../utils/errors";
import { formatDateTime } from "../../utils/date";

interface Props {
  reservation: RestaurantReservation | null;
  canUpdate: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: (r: RestaurantReservation) => void;
}

export default function RestaurantReservationDetail({ reservation, canUpdate, canDelete, onClose, onEdit, onDelete }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [flipping, setFlipping] = useState<{ id: number; label: string; status: ReservationStatus } | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ id, status: s }: { id: number; status: ReservationStatus }) =>
      api.post(`/restaurant/reservations/${id}/status`, { status: s }),
    onSuccess: () => {
      addToast("Reservation updated", "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor-reservations"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update reservation"), "error"),
  });

  if (!reservation) return null;
  const r = reservation;

  const requestStatus = (a: ReservationAction) => {
    if (a.confirm) {
      setFlipping({ id: r.id, label: a.label.toLowerCase(), status: a.status });
    } else {
      statusMutation.mutate({ id: r.id, status: a.status });
    }
  };

  const actions = reservationActions(r, canUpdate);

  return (
    <SlideOver
      open
      onClose={onClose}
      title={r.guest_name}
      breadcrumb={`Reservation ${r.reservation_number}`}
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Reservation"
          title={r.guest_name}
          subtitle={`${r.reservation_number} · Booked by ${r.username}`}
          actions={<span className={`badge ${RESERVATION_STATUS_BADGE[r.status]}`}>{r.status}</span>}
        />

        <PanelSection label="Booking Details">
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {r.guest_phone && (
              <div>
                <dt className={panelSectionLabel}>Phone</dt>
                <dd className="font-medium mt-1">
                  <a href={`tel:${r.guest_phone}`} className="text-primary-strong dark:text-primary hover:underline">
                    {r.guest_phone}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className={panelSectionLabel}>Party</dt>
              <dd className="font-medium mt-1">{r.guest_count} guest{r.guest_count === 1 ? "" : "s"}</dd>
            </div>
            <div>
              <dt className={panelSectionLabel}>Table</dt>
              <dd className="font-medium mt-1">{r.table_number || "No table assigned"}</dd>
            </div>
            <div>
              <dt className={panelSectionLabel}>When</dt>
              <dd className="font-medium mt-1">{formatDateTime(r.reserved_at)} · {r.duration_minutes} min</dd>
            </div>
          </dl>
        </PanelSection>

        {r.notes && (
          <PanelSection label="Notes">
            <p className="text-sm text-ink whitespace-pre-wrap">{r.notes}</p>
          </PanelSection>
        )}

        <PanelSection label="Record">
          {r.ticket_id && (
            <Link to={`/restaurant/tickets/${r.ticket_id}`} className="btn-primary w-full flex items-center justify-center gap-1.5">
              View linked ticket
            </Link>
          )}
          <p className="text-xs text-faint mt-3">
            Created {formatDateTime(r.created_at)}{r.created_at !== r.updated_at && ` · Updated ${formatDateTime(r.updated_at)}`}
          </p>
        </PanelSection>

        <PanelFooter>
          {actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 mr-auto">
              {actions.map((a) => (
                <button key={a.status} onClick={() => requestStatus(a)} className={`text-sm ${a.cls}`}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {canUpdate && onEdit && (
            <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5">
              <Pencil size={15} /> Edit
            </button>
          )}
          {canDelete && onDelete && (
            <button onClick={() => onDelete(r)} className="btn-danger flex items-center gap-1.5">
              <Trash2 size={15} /> Delete
            </button>
          )}
        </PanelFooter>
      </PanelCard>

      <ConfirmDialog
        open={!!flipping}
        title="Confirm Reservation Change"
        message={`Mark this reservation as ${flipping?.status === "no_show" ? "a no-show" : "cancelled"}? This cannot be undone.`}
        confirmLabel={flipping ? flipping.label[0].toUpperCase() + flipping.label.slice(1) : "Yes"}
        confirmClass={flipping?.status === "cancelled" || flipping?.status === "no_show" ? "btn-danger" : "btn-primary"}
        onConfirm={() => {
          if (flipping) statusMutation.mutate({ id: flipping.id, status: flipping.status });
          setFlipping(null);
        }}
        onCancel={() => setFlipping(null)}
      />
    </SlideOver>
  );
}