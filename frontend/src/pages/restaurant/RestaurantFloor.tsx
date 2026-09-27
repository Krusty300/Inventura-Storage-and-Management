import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, RefreshCw, Plus, CookingPot, Move, MapPin, QrCode } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantTable, RestaurantReservation } from "../../types";
import EmptyState from "../../components/EmptyState";
import FittedSelect from "../../components/FittedSelect";
import RestaurantReservationDetail from "../../components/restaurant/RestaurantReservationDetail";
import RestaurantTableDetail from "../../components/restaurant/RestaurantTableDetail";
import { printBlob } from "../../utils/download";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { errorMessage } from "../../utils/errors";

const RESERVATION_BADGE: Record<string, string> = {
  pending: "badge-warning",
  confirmed: "badge-info",
  seated: "badge-success",
};

const SERVICE_LABELS: Record<string, string> = {
  waiter: "Calls waiter",
  bill: "Bill requested",
  assistance: "Needs assistance",
};

function reservationLabel(r: RestaurantReservation): string {
  const d = new Date(r.reserved_at);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `@ ${h}:${m} · ${r.guest_name}`;
}

function isActiveNow(r: RestaurantReservation, nowMs: number): boolean {
  const start = new Date(r.reserved_at).getTime();
  const end = start + r.duration_minutes * 60_000;
  return nowMs >= start && nowMs < end;
}

function ReservationBadge({ reservation, onOpen }: { reservation: RestaurantReservation; onOpen: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpen(); } }}
      className={`badge ${RESERVATION_BADGE[reservation.status]} cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      title={`View ${reservation.guest_name}'s reservation`}
    >
      {reservation.status === "pending" ? "Booking" : "Reserved"} {reservationLabel(reservation)}
    </span>
  );
}

export default function RestaurantFloor() {
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { subscribe } = useRealtime();

  const [onlyMine, setOnlyMine] = useState(false);
  const [zoneFilter, setZoneFilter] = useState("");
  const [opening, setOpening] = useState(false);
  const [view, setView] = useState<"plan" | "grid">("grid");
  const [override, setOverride] = useState<Record<number, { x: number; y: number }>>({});
  const [reservationDetail, setReservationDetail] = useState<RestaurantReservation | null>(null);
  const [tableDetail, setTableDetail] = useState<RestaurantTable | null>(null);
  const dragRef = useRef<{ id: number; grabX: number; grabY: number } | null>(null);
  const draggedRef = useRef(false);
  const planRef = useRef<HTMLDivElement | null>(null);

  const { data: tables, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-floor"],
    queryFn: async () => {
      const { data } = await api.get("/restaurant/tables");
      return data as RestaurantTable[];
    },
  });

  const { data: reservations } = useQuery({
    queryKey: ["restaurant-floor-reservations"],
    queryFn: async () => {
      const { data } = await api.get("/restaurant/reservations", { params: { upcoming_only: true, limit: 200 } });
      return (data as { items: RestaurantReservation[] }).items;
    },
  });

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (
        msg.entity === "restaurant_ticket" || msg.entity === "restaurant_table" || msg.entity === "restaurant_reservation"
      ) {
        queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-floor-reservations"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
      }
    });
    return unsub;
  }, [subscribe, queryClient]);

  const openTicket = useMutation({
    mutationFn: async (tableId: number | null) => {
      if (tableId === null) {
        const { data } = await api.post("/restaurant/tickets", {});
        return data;
      }
      const now = Date.now();
      const active = (reservations ?? []).find(
        (r) => r.table_id === tableId && (r.status === "pending" || r.status === "confirmed" || r.status === "seated") && isActiveNow(r, now),
      );
      const { data } = await api.post("/restaurant/tickets", active ? { reservation_id: active.id } : { table_id: tableId });
      return data;
    },
    onSuccess: (ticket) => {
      addToast(`Opened ticket ${ticket.ticket_number}`, "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor-reservations"] });
      navigate(`/restaurant/tickets/${ticket.id}`);
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot open ticket"), "error");
    },
    onSettled: () => setOpening(false),
  });

  const clearService = useMutation({
    mutationFn: async (tableId: number) => {
      await api.post(`/restaurant/tables/${tableId}/service-request/clear`);
      return tableId;
    },
    onSuccess: (tableId) => {
      addToast(`Cleared service request for table ${tableId}`, "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot clear service request"), "error"),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, pos_x, pos_y }: { id: number; pos_x: number; pos_y: number }) => {
      await api.put(`/restaurant/tables/${id}`, { pos_x, pos_y });
      return { id, pos_x, pos_y };
    },
    onSuccess: ({ id, pos_x, pos_y }) => {
      queryClient.setQueryData<RestaurantTable[]>(["restaurant-floor"], (old) =>
        old?.map((t) => (t.id === id ? { ...t, pos_x, pos_y } : t)) ?? old,
      );
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot save table position"), "error"),
  });

  const activeTables = (tables ?? []).filter((t) => t.is_active);
  const zoneOptions = useMemo(() => {
    const zones = new Set<string>();
    for (const t of tables ?? []) {
      if (t.zone) zones.add(t.zone);
    }
    return [{ value: "", label: "All zones" }, ...[...zones].sort().map((z) => ({ value: z, label: z }))];
  }, [tables]);
  const zoneTables = zoneFilter
    ? (tables ?? []).filter((t) => (t.zone || "Main") === zoneFilter)
    : (tables ?? []);
  const renderedTables = onlyMine
    ? zoneTables.filter((t) => t.active_ticket_username === user?.username)
    : zoneTables;

  const byZone = useMemo(() => {
    const zones = new Map<string, RestaurantTable[]>();
    for (const t of renderedTables) {
      const zone = t.zone || "Main";
      const list = zones.get(zone) ?? [];
      list.push(t);
      zones.set(zone, list);
    }
    if (zones.size === 0) zones.set("Main", []);
    return zones;
  }, [renderedTables]);

  const hasPositions = (tables ?? []).some((t) => t.pos_x !== 0 || t.pos_y !== 0);
  const currentlyPlan = view === "plan";

  const reservationsByTable = useMemo(() => {
    const map = new Map<number, RestaurantReservation[]>();
    for (const r of reservations ?? []) {
      if (r.table_id === null || r.status === "cancelled" || r.status === "no_show") continue;
      const list = map.get(r.table_id) ?? [];
      list.push(r);
      map.set(r.table_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.reserved_at).getTime() - new Date(b.reserved_at).getTime());
    return map;
  }, [reservations]);

  const upcomingBadge = (t: RestaurantTable): RestaurantReservation | null => {
    const list = (reservationsByTable.get(t.id) ?? []).filter((r) => r.status === "pending" || r.status === "confirmed");
    if (list.length === 0 || t.status === "occupied") return null;
    const nowMs = Date.now();
    return list.find((r) => isActiveNow(r, nowMs)) ?? list[0];
  };

  const positioned = (t: RestaurantTable): { x: number; y: number } => override[t.id] ?? { x: t.pos_x, y: t.pos_y };
  const maxY = Math.max(320, ...(tables ?? []).map((t) => t.pos_y + 150), ...Object.values(override).map((p) => p.y + 150));

  const startDrag = (e: React.PointerEvent, t: RestaurantTable) => {
    if (!can("restaurant.update")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = positioned(t);
    dragRef.current = { id: t.id, grabX: e.clientX - x, grabY: e.clientY - y };
    draggedRef.current = false;
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !planRef.current) return;
    draggedRef.current = true;
    const rect = planRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - d.grabX));
    const y = Math.max(0, Math.round(e.clientY - rect.top - d.grabY));
    setOverride((ov) => ({ ...ov, [d.id]: { x, y } }));
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    const moved = draggedRef.current;
    dragRef.current = null;
    const pos = override[d.id];
    setOverride((ov) => {
      const next = { ...ov };
      delete next[d.id];
      return next;
    });
    if (moved && pos) moveMutation.mutate({ id: d.id, pos_x: pos.x, pos_y: pos.y });
  };

  const available = activeTables.filter((t) => t.status === "available").length;
  const occupied = activeTables.filter((t) => t.status === "occupied").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <LayoutGrid size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Floor Map</h1>
            <p className="text-sm text-muted mt-1">
              {available} available · {occupied} occupied
              {currentlyPlan && hasPositions && <span> · drag tables to reposition</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(tables ?? []).length > 0 && (
            <div className="flex rounded-lg overflow-hidden border border-border-strong" role="group" aria-label="Floor view">
              <button
                onClick={() => setView("grid")}
                className={`px-3 py-1.5 text-sm font-medium ${view === "grid" ? "bg-app text-ink" : "hover:bg-app text-muted"}`}
              >
                Grid
              </button>
              <button
                onClick={() => setView("plan")}
                className={`px-3 py-1.5 text-sm font-medium ${view === "plan" ? "bg-app text-ink" : "hover:bg-app text-muted"}`}
              >
                Plan
              </button>
            </div>
          )}
          {zoneOptions.length > 1 && (
            <FittedSelect
              value={zoneFilter}
              onChange={setZoneFilter}
              ariaLabel="Filter by zone"
              maxWidth={200}
              options={zoneOptions}
            />
          )}
          {user && (
            <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none" aria-label="Show only my tables">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(e) => setOnlyMine(e.target.checked)}
                className="accent-primary-strong"
                aria-label="Show only my tables"
              />
              <span className="hidden sm:inline">Only mine</span>
            </label>
          )}
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] })} className="btn-secondary" aria-label="Refresh floor map">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => {
              const base = window.location.origin;
              void api
                .get("/restaurant/qr-sheet", { params: { base }, responseType: "blob" })
                .then(({ data }) => printBlob(data))
                .catch((err: unknown) => addToast(errorMessage(err, "Cannot generate QR codes"), "error"));
            }}
            className="btn-secondary flex items-center gap-1.5"
            aria-label="Print table QR codes"
          >
            <QrCode size={16} />
            QR Codes
          </button>
          {can("restaurant.create") && (
            <button
              onClick={() => { setOpening(true); openTicket.mutate(null); }}
              disabled={opening}
              className="btn-primary flex items-center gap-1.5"
            >
              <CookingPot size={16} />
              Takeaway
            </button>
          )}
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load floor map")}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-36 animate-pulse bg-app" />
          ))}
        </div>
      ) : (tables ?? []).length === 0 ? (
        <div className="card p-6">
          <EmptyState
            variant="table"
            icon={<LayoutGrid size={48} />}
            title="No tables yet"
            message="Set up your floor plan in the Tables section, then open tickets here."
          />
        </div>
      ) : currentlyPlan ? (
        <div className="card overflow-hidden p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted flex items-center gap-1.5">
              <Move size={14} className="text-faint" />
              {can("restaurant.update")
                ? hasPositions
                  ? "Drag any table to rearrange the floor plan."
                  : "All tables start stacked at the top-left — drag them into place."
                : "Floor plan preview."}
            </p>
            <span className="text-xs text-faint">Positions are saved automatically</span>
          </div>
          <div
            ref={planRef}
            className="relative rounded-xl border border-border-strong/60 bg-app/50"
            style={{ height: maxY, minWidth: 640 }}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-floor-testid="plan"
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
            {(renderedTables).map((t) => {
              const pos = positioned(t);
              const badge = upcomingBadge(t);
              return (
                <button
                  key={t.id}
                  onPointerDown={(e) => startDrag(e, t)}
                  onClick={() => {
                    if (draggedRef.current) return;
                    setTableDetail(t);
                  }}
                  className={`group absolute select-none text-left rounded-xl border-2 p-3 transition ${t.status === "occupied" ? "border-primary/70 bg-primary-soft/40 cursor-pointer" : "border-border-strong bg-card hover:border-primary/50 cursor-move"}`}
                  style={{ left: pos.x, top: pos.y, width: 156, touchAction: "none" }}
                  aria-label={`Table ${t.number} — ${t.status}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-lg text-ink">{t.number}</span>
                    <span className={`badge ${t.status === "occupied" ? "badge-warning" : "badge-success"}`}>
                      {t.status === "occupied" ? "Occupied" : `Free`}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">Seats {t.capacity}</div>
                  {t.zone && <div className="text-xs text-faint mt-0.5">{t.zone}</div>}
                  {t.service_request && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="badge badge-danger">{SERVICE_LABELS[t.service_request] ?? "Needs service"}</span>
                      {can("restaurant.update") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); clearService.mutate(t.id); }}
                          className="text-xs text-primary hover:text-primary-strong underline"
                          aria-label={`Clear service request for table ${t.number}`}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                  {badge && (
                    <div className="mt-2 space-y-1">
                      <ReservationBadge reservation={badge} onOpen={() => setReservationDetail(badge)} />
                    </div>
                  )}
                  {t.status === "occupied" && (
                    <div className="mt-2 flex items-center gap-1.5 text-sm text-primary-strong dark:text-primary font-medium">
                      <Plus size={14} />
                      {t.active_ticket_number}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        [...byZone.entries()].map(([zone, zoneTables]) => (
          <div key={zone}>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">{zone}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {zoneTables.map((t) => {
                const badge = upcomingBadge(t);
                return (
                  <button
                    key={t.id}
                    onClick={() => setTableDetail(t)}
                    className={`card p-4 text-left transition ${t.status === "occupied" ? "ring-2 ring-primary/60" : "hover:bg-app"} cursor-pointer`}
                    aria-label={`Table ${t.number} — ${t.status}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-lg text-ink">{t.number}</div>
                        <div className="text-xs text-muted mt-0.5">Seats {t.capacity}</div>
                        {t.zone && <div className="text-xs text-faint mt-0.5">{t.zone}</div>}
                        {t.service_request && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="badge badge-danger">{SERVICE_LABELS[t.service_request] ?? "Needs service"}</span>
                            {can("restaurant.update") && (
                              <button
                                onClick={(e) => { e.stopPropagation(); clearService.mutate(t.id); }}
                                className="text-xs text-primary hover:text-primary-strong underline"
                                aria-label={`Clear service request for table ${t.number}`}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <span className={`badge ${t.status === "occupied" ? "badge-warning" : "badge-success"}`}>
                        {t.status === "occupied" ? "Occupied" : "Free"}
                      </span>
                    </div>
                    {badge ? (
                      <div className="mt-3 space-y-1.5">
                        <ReservationBadge reservation={badge} onOpen={() => setReservationDetail(badge)} />
                      </div>
                    ) : t.status === "occupied" ? (
                      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                        <Plus size={14} />
                        {t.active_ticket_number}
                      </div>
                    ) : (
                      can("restaurant.create") && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-primary-strong dark:text-primary">
                          <Plus size={14} />
                          Open ticket
                        </div>
                      )
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <button
                onClick={() => setView("plan")}
                className="text-sm text-primary-strong dark:text-primary hover:underline inline-flex items-center gap-1.5"
              >
                <MapPin size={14} />
                Arrange on floor plan
              </button>
            </div>
          </div>
        ))
      )}

      <RestaurantReservationDetail
        reservation={reservationDetail}
        canUpdate={can("restaurant.update")}
        canDelete={false}
        onClose={() => setReservationDetail(null)}
      />

      <RestaurantTableDetail
        table={tableDetail}
        reservations={tableDetail ? reservationsByTable.get(tableDetail.id) ?? [] : []}
        canCreate={can("restaurant.create")}
        onClose={() => setTableDetail(null)}
        onOpenTicket={(tableId) => openTicket.mutate(tableId)}
        onOpenReservation={(r) => { setTableDetail(null); setReservationDetail(r); }}
      />
    </div>
  );
}