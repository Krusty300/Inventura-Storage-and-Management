import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, RefreshCw, Plus, CookingPot, Move, MapPin } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantTable, RestaurantReservation } from "../../types";
import EmptyState from "../../components/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { errorMessage } from "../../utils/errors";

const RESERVATION_BADGE: Record<string, string> = {
  pending: "badge-warning",
  confirmed: "badge-info",
  seated: "badge-success",
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

export default function RestaurantFloor() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { subscribe } = useRealtime();

  const [opening, setOpening] = useState(false);
  const [view, setView] = useState<"plan" | "grid">("grid");
  const [override, setOverride] = useState<Record<number, { x: number; y: number }>>({});
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
      const active = tableId === null ? null : (reservations ?? []).find((r) => r.table_id === tableId && isActiveNow(r, Date.now()));
      const payload = tableId === null ? {} : { table_id: tableId };
      if (active) (payload as { reservation_id: number }).reservation_id = active.id;
      const { data } = await api.post("/restaurant/tickets", payload);
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
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, pos_x, pos_y }: { id: number; pos_x: number; pos_y: number }) =>
      api.put(`/restaurant/tables/${id}`, { pos_x, pos_y }),
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot save table position"), "error"),
  });

  const byZone = useMemo(() => {
    const zones = new Map<string, RestaurantTable[]>();
    for (const t of tables ?? []) {
      const zone = t.zone || "Main";
      const list = zones.get(zone) ?? [];
      list.push(t);
      zones.set(zone, list);
    }
    if (zones.size === 0) zones.set("Main", []);
    return zones;
  }, [tables]);

  const hasPositions = (tables ?? []).some((t) => t.pos_x !== 0 || t.pos_y !== 0);
  const effectiveView = view === "plan" ? (hasPositions ? "plan" : "grid") : "grid";
  const currentlyPlan = effectiveView === "plan";

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

  const available = (tables ?? []).filter((t) => t.status === "available").length;
  const occupied = (tables ?? []).filter((t) => t.status === "occupied").length;

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
          {hasPositions && (
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
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] })} className="btn-secondary" aria-label="Refresh floor map">
            <RefreshCw size={16} />
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
              {can("restaurant.update") ? "Drag any table to rearrange the floor plan." : "Floor plan preview."}
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
            {(tables ?? []).map((t) => {
              const pos = positioned(t);
              const badge = upcomingBadge(t);
              return (
                <button
                  key={t.id}
                  onPointerDown={(e) => startDrag(e, t)}
                  onClick={() => {
                    if (draggedRef.current) return;
                    if (t.status === "occupied") navigate(`/restaurant/tickets/${t.active_ticket_id}`);
                    else if (can("restaurant.create")) openTicket.mutate(t.id);
                  }}
                  className={`group absolute select-none text-left rounded-xl border-2 p-3 transition ${t.status === "occupied" ? "border-primary/70 bg-primary-soft/40 cursor-pointer" : "border-border-strong bg-card hover:border-primary/50 cursor-move"}`}
                  style={{ left: pos.x, top: pos.y, width: 156 }}
                  aria-label={`Table ${t.number} — ${t.status}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-lg text-ink">{t.number}</span>
                    <span className={`badge ${t.status === "occupied" ? "badge-warning" : "badge-success"}`}>
                      {t.status === "occupied" ? "Occupied" : `Free`}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">Seats {t.capacity}</div>
                  {badge && (
                    <div className="mt-2 space-y-1">
                      <span className={`badge ${RESERVATION_BADGE[badge.status]}`}>
                        {badge.status === "pending" ? "Booking" : "Reserved"} {reservationLabel(badge)}
                      </span>
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
                    onClick={() => {
                      if (t.status === "occupied") navigate(`/restaurant/tickets/${t.active_ticket_id}`);
                      else if (can("restaurant.create")) openTicket.mutate(t.id);
                    }}
                    disabled={t.status === "available" && !can("restaurant.create")}
                    className={`card p-4 text-left transition ${t.status === "occupied" ? "ring-2 ring-primary/60" : "hover:bg-app"} ${t.status === "available" && !can("restaurant.create") ? "cursor-default opacity-70" : "cursor-pointer"}`}
                    aria-label={`Table ${t.number} — ${t.status}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-lg text-ink">{t.number}</div>
                        <div className="text-xs text-muted mt-0.5">Seats {t.capacity}</div>
                      </div>
                      <span className={`badge ${t.status === "occupied" ? "badge-warning" : "badge-success"}`}>
                        {t.status === "occupied" ? "Occupied" : "Free"}
                      </span>
                    </div>
                    {badge ? (
                      <div className="mt-3 space-y-1.5">
                        <span className={`badge ${RESERVATION_BADGE[badge.status]}`}>
                          {badge.status === "pending" ? "Booking" : "Reserved"} {reservationLabel(badge)}
                        </span>
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
    </div>
  );
}