import { useMemo, useState } from "react";
import { CalendarClock, Pencil, Phone, Printer, Trash2, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantReservation, ReservationStatus, RestaurantTable } from "../../types";
import Table from "../../components/Table";
import EmptyState from "../../components/EmptyState";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { errorMessage } from "../../utils/errors";
import { formatDateTime } from "../../utils/date";
import { printBlob } from "../../utils/download";

const STATUSES: { value: ReservationStatus | ""; label: string; cls: string }[] = [
  { value: "", label: "All", cls: "" },
  { value: "pending", label: "Pending", cls: "badge-warning" },
  { value: "confirmed", label: "Confirmed", cls: "badge-info" },
  { value: "seated", label: "Seated", cls: "badge-success" },
  { value: "completed", label: "Completed", cls: "badge-neutral" },
  { value: "cancelled", label: "Cancelled", cls: "badge-neutral" },
  { value: "no_show", label: "No-show", cls: "badge-danger" },
];

const STATUS_BADGE: Record<ReservationStatus, string> = {
  pending: "badge-warning",
  confirmed: "badge-info",
  seated: "badge-success",
  completed: "badge-neutral",
  cancelled: "badge-danger",
  no_show: "badge-danger",
};

const ACTIVE: ReservationStatus[] = ["pending", "confirmed", "seated"];

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function RestaurantReservations() {
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<ReservationStatus | "">("");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RestaurantReservation | null>(null);
  const [deleting, setDeleting] = useState<RestaurantReservation | null>(null);
  const [flipping, setFlipping] = useState<{ id: number; label: string; status: ReservationStatus } | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-reservations", status, date, search, limit],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(limit) };
      if (status) params.status = status;
      if (date) params.date = date;
      if (search.trim()) params.search = search.trim();
      const { data: res } = await api.get("/restaurant/reservations", { params });
      return res as { items: RestaurantReservation[]; total: number; pages: number };
    },
  });

  const { data: tables } = useQuery({
    queryKey: ["restaurant-tables"],
    queryFn: async () => {
      const { data: res } = await api.get("/restaurant/tables");
      return res as RestaurantTable[];
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status: s }: { id: number; status: ReservationStatus }) =>
      api.post(`/restaurant/reservations/${id}/status`, { status: s }),
    onSuccess: () => {
      addToast("Reservation updated", "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update reservation"), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/restaurant/reservations/${id}`),
    onSuccess: () => {
      addToast("Reservation deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete reservation"), "error"),
  });

  const activePills = useMemo(() => STATUSES.filter((s) => !s.value || ACTIVE.includes(s.value)), []);

  const actions = (r: RestaurantReservation): { label: string; status: ReservationStatus; cls: string; confirm?: boolean }[] => {
    if (!can("restaurant.update")) return [];
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
  };

  const requestStatus = (r: RestaurantReservation, a: { label: string; status: ReservationStatus; confirm?: boolean }) => {
    if (a.confirm) {
      setFlipping({ id: r.id, label: a.label.toLowerCase(), status: a.status });
    } else {
      statusMutation.mutate({ id: r.id, status: a.status });
    }
  };

  const printDaySheet = async () => {
    try {
      const { data } = await api.get("/restaurant/reservations/sheet", { params: { date }, responseType: "blob" });
      printBlob(data);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Cannot print reservations sheet"), "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <CalendarClock size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Reservations</h1>
            <p className="text-sm text-muted mt-1">Bookings, party sizes, and seating across the floor.</p>
          </div>
        </div>
        {can("restaurant.create") && (
          <div className="flex items-center gap-2">
            <button onClick={printDaySheet} className="btn-secondary flex items-center gap-1.5" aria-label="Print reservations day sheet">
              <Printer size={16} /> Day Sheet
            </button>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
              New Reservation
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {activePills.map((s) => (
            <button
              key={s.value || "all"}
              onClick={() => setStatus(s.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                status === s.value ? (s.cls || "bg-primary-soft text-primary-strong dark:text-primary") : "text-muted hover:bg-app"
              }`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setStatus("cancelled")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${status === "cancelled" ? "badge-neutral" : "text-muted hover:bg-app"}`}
          >
            Cancelled
          </button>
          <button
            onClick={() => setStatus("no_show")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${status === "no_show" ? "badge-danger" : "text-muted hover:bg-app"}`}
          >
            No-show
          </button>
          <button
            onClick={() => setStatus("completed")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${status === "completed" ? "badge-neutral" : "text-muted hover:bg-app"}`}
          >
            Completed
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <input
            className="input w-56"
            placeholder="Search guest, phone, booking #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search reservations"
          />
          <input
            type="date"
            className="input w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Filter by date"
          />
          {date && (
            <button onClick={() => setDate("")} className="btn-secondary" aria-label="Clear date filter">
              Clear
            </button>
          )}
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load reservations")}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Restaurant reservations"
          role="grid"
          columns={[
            { key: "guest", header: "Guest" },
            { key: "table", header: "Table" },
            { key: "party", header: "Party", className: "px-4 py-3 text-right" },
            { key: "time", header: "When" },
            { key: "status", header: "Status" },
            { key: "actions", header: "", className: "px-4 py-3" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={!isLoading && (data?.items ?? []).length === 0}
          empty={
            <EmptyState
              variant="table"
              icon={<CalendarClock size={48} />}
              title={search || date || status ? "No matching reservations" : "No reservations yet"}
              message={search || date || status ? "Try adjusting the filters." : "Book a table for a guest to see it here."}
              actionLabel={can("restaurant.create") && !status && !date && !search ? "New Reservation" : undefined}
              onAction={() => { setEditing(null); setShowForm(true); }}
            />
          }
        >
          {(data?.items ?? []).map((r) => (
            <tr key={r.id} className="hover:bg-app">
              <td className="px-4 py-3">
                <div className="font-medium text-ink">{r.guest_name}</div>
                <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                  {r.guest_phone ? (
                    <>
                      <Phone size={11} />
                      {r.guest_phone}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1">—</span>
                  )}
                </div>
                <div className="text-xs text-faint mt-0.5">{r.reservation_number}</div>
              </td>
              <td className="px-4 py-3 text-muted">
                {r.table_number ? (
                  <span className="inline-flex items-center gap-1">
                    <Users size={13} className="text-faint" />
                    {r.table_number}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-right font-medium">{r.guest_count}</td>
              <td className="px-4 py-3">
                <div className="font-medium">{formatDateTime(r.reserved_at)}</div>
                <div className="text-xs text-muted mt-0.5">{r.duration_minutes} min</div>
              </td>
              <td className="px-4 py-3">
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-4">
                  <div className="flex gap-3">
                    {actions(r).map((a) => (
                      <button
                        key={a.status}
                        onClick={() => requestStatus(r, a)}
                        className={`text-sm ${a.cls}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  {can("restaurant.update") && r.status !== "cancelled" && r.status !== "no_show" && (
                    <button onClick={() => { setEditing(r); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit reservation ${r.reservation_number}`}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {can("restaurant.delete") && (
                    <button onClick={() => setDeleting(r)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete reservation ${r.reservation_number}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>

      {Number(data?.total ?? 0) > limit && (
        <div className="flex justify-center">
          <button onClick={() => setLimit((n) => n + 50)} className="btn-secondary">
            Load more ({data?.total} total)
          </button>
        </div>
      )}

      {showForm && (
        <ReservationForm
          reservation={editing}
          tables={tables ?? []}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["restaurant-reservations"] });
            queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Reservation"
        message={`Delete ${deleting?.reservation_number} for ${deleting?.guest_name}?`}
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />

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
    </div>
  );
}

function ReservationForm({
  reservation, tables, onClose, onSaved,
}: {
  reservation: RestaurantReservation | null;
  tables: RestaurantTable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [guestName, setGuestName] = useState(reservation?.guest_name ?? "");
  const [guestPhone, setGuestPhone] = useState(reservation?.guest_phone ?? "");
  const [guestCount, setGuestCount] = useState(reservation?.guest_count ?? 2);
  const [tableId, setTableId] = useState<number | "">(reservation?.table_id ?? "");
  const [reservedAt, setReservedAt] = useState(() => {
    if (reservation) return toLocalInputValue(reservation.reserved_at);
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return toLocalInputValue(d.toISOString());
  });
  const [duration, setDuration] = useState(reservation?.duration_minutes ?? 90);
  const [notes, setNotes] = useState(reservation?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (!reservedAt) throw new Error("Pick a booking time");
      const payload = {
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim(),
        guest_count: Math.max(1, guestCount),
        table_id: tableId === "" ? null : Number(tableId),
        reserved_at: new Date(reservedAt).toISOString(),
        duration_minutes: Math.max(15, Math.min(1440, duration)),
        notes,
      };
      if (reservation) {
        await api.put(`/restaurant/reservations/${reservation.id}`, payload);
        addToast("Reservation updated", "success");
      } else {
        await api.post("/restaurant/reservations", payload);
        addToast("Reservation created", "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to save reservation"), "error");
    }
    setSaving(false);
  };

  const activeTables = tables.filter((t) => t.is_active);

  return (
    <Modal open onClose={onClose} title={reservation ? `Edit ${reservation.reservation_number}` : "New Reservation"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-guest">Guest name *</label>
          <input id="res-guest" className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} required placeholder="e.g. Alice Banda" maxLength={120} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-phone">Phone</label>
            <input id="res-phone" className="input" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="07..." maxLength={40} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-count">Party size</label>
            <input id="res-count" className="input" type="number" min={1} max={99} value={guestCount} onChange={(e) => setGuestCount(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-table">Table</label>
          <select id="res-table" className="input" value={tableId} onChange={(e) => setTableId(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">No table</option>
            {activeTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.number} — seats {t.capacity}{t.status === "occupied" ? " (occupied)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-time">When *</label>
            <input id="res-time" className="input" type="datetime-local" value={reservedAt} onChange={(e) => setReservedAt(e.target.value)} required min={toLocalInputValue(new Date(Date.now() - 15 * 60 * 1000).toISOString())} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-duration">Duration (min)</label>
            <input id="res-duration" className="input" type="number" min={15} max={1440} step={5} value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 90)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="res-notes">Notes</label>
          <textarea id="res-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, celebration, special requests..." maxLength={500} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !guestName.trim()} className="btn-primary">{saving ? "Saving..." : reservation ? "Update" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}