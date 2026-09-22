import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, RefreshCw, Plus, CookingPot } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantTable } from "../../types";
import EmptyState from "../../components/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { errorMessage } from "../../utils/errors";

export default function RestaurantFloor() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { subscribe } = useRealtime();

  const [opening, setOpening] = useState(false);

  const { data: tables, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-floor"],
    queryFn: async () => {
      const { data } = await api.get("/restaurant/tables");
      return data as RestaurantTable[];
    },
  });

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.entity === "restaurant_ticket" || msg.entity === "restaurant_table") {
        queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] });
        queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
      }
    });
    return unsub;
  }, [subscribe, queryClient]);

  const openTicket = useMutation({
    mutationFn: async (tableId: number | null) => {
      const payload = tableId === null ? {} : { table_id: tableId };
      const { data } = await api.post("/restaurant/tickets", payload);
      return data;
    },
    onSuccess: (ticket) => {
      addToast(`Opened ticket ${ticket.ticket_number}`, "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
      navigate(`/restaurant/tickets/${ticket.id}`);
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot open ticket"), "error");
    },
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
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
      ) : (
        [...byZone.entries()].map(([zone, zoneTables]) => (
          <div key={zone}>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">{zone}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {zoneTables.map((t) => (
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
                  {t.status === "occupied" ? (
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
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}