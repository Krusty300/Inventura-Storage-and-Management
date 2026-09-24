import type { RestaurantReservation, ReservationStatus } from "../../types";

export const RESERVATION_STATUS_BADGE: Record<ReservationStatus, string> = {
  pending: "badge-warning",
  confirmed: "badge-info",
  seated: "badge-success",
  completed: "badge-neutral",
  cancelled: "badge-danger",
  no_show: "badge-danger",
};

export type ReservationAction = { label: string; status: ReservationStatus; cls: string; confirm?: boolean };

export function reservationActions(r: RestaurantReservation, canUpdate: boolean): ReservationAction[] {
  if (!canUpdate) return [];
  if (r.status === "pending") return [
    { label: "Confirm", status: "confirmed", cls: "text-primary-strong dark:text-primary font-medium" },
    { label: "Seat", status: "seated", cls: "text-success font-medium" },
    { label: "Cancel", status: "cancelled", cls: "text-red-600 dark:text-red-400", confirm: true },
    { label: "No-show", status: "no_show", cls: "text-red-600 dark:text-red-400", confirm: true },
  ];
  if (r.status === "confirmed") return [
    { label: "Seat", status: "seated", cls: "text-success font-medium" },
    { label: "Cancel", status: "cancelled", cls: "text-red-600 dark:text-red-400", confirm: true },
    { label: "No-show", status: "no_show", cls: "text-red-600 dark:text-red-400", confirm: true },
  ];
  if (r.status === "seated") return [
    { label: "Cancel", status: "cancelled", cls: "text-red-600 dark:text-red-400", confirm: true },
  ];
  return [];
}