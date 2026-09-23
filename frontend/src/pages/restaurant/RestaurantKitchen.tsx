import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChefHat, CheckCircle2, Clock, Printer } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { KitchenTicket, RestaurantTicketItem } from "../../types";
import EmptyState from "../../components/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";
import { errorMessage } from "../../utils/errors";
import { printBlob } from "../../utils/download";

const STAGES: { key: "queued" | "preparing" | "ready"; label: string; tone: string }[] = [
  { key: "queued", label: "Queued", tone: "border-t-muted/50" },
  { key: "preparing", label: "Preparing", tone: "border-t-sky-500/70" },
  { key: "ready", label: "Ready", tone: "border-t-emerald-500/70" },
];

type ItemStatus = RestaurantTicketItem["status"];

function elapsedMin(sentAt: string | null): number {
  if (!sentAt) return 0;
  const t = new Date(sentAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(Math.floor((Date.now() - t) / 60_000), 0);
}

export default function RestaurantKitchen() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { subscribe } = useRealtime();

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.entity === "restaurant_ticket" || msg.entity === "restaurant_table") {
        queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
      }
    });
    return unsub;
  }, [subscribe, queryClient]);

  const { data: board, isLoading, isError, error } = useQuery({
    queryKey: ["restaurant-kitchen"],
    queryFn: async () => {
      const { data } = await api.get("/restaurant/kitchen/board");
      return data as KitchenTicket[];
    },
    refetchInterval: 15_000,
  });

  const [advancing, setAdvancing] = useState<`${number}:${number}` | null>(null);
  const [newOrder, setNewOrder] = useState<string | null>(null);
  const seenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!board) return;
    const fresh = board.filter((t) => !seenRef.current.has(t.id));
    const firstLoad = seenRef.current.size === 0;
    for (const t of fresh) {
      seenRef.current.add(t.id);
      if (!firstLoad) {
        addToast(`New order ${t.ticket_number} (${t.table_number})`, "info");
        setNewOrder(`${t.ticket_number} · ${t.table_number}`);
      }
    }
  }, [board, addToast]);

  useEffect(() => {
    if (!newOrder) return;
    const timer = window.setTimeout(() => setNewOrder(null), 8000);
    return () => window.clearTimeout(timer);
  }, [newOrder]);

  const advance = useMutation({
    mutationFn: async ({ ticketId, itemId, status }: { ticketId: number; itemId: number; status: string }) => {
      const { data } = await api.put(`/restaurant/tickets/${ticketId}/items/${itemId}/status`, { status });
      return data;
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ["restaurant-kitchen"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-ticket", ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-floor"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update item"), "error"),
    onSettled: () => setAdvancing(null),
  });

  const startAdvance = (ticketId: number, itemId: number, status: string) => {
    setAdvancing(`${ticketId}:${itemId}`);
    advance.mutate({ ticketId, itemId, status });
  };

  const nextStep = (status: ItemStatus): string | null => {
    if (status === "queued") return "preparing";
    if (status === "preparing") return "ready";
    if (status === "ready") return "served";
    return null;
  };

  const byStage = useMemo(() => {
    const map: Record<string, KitchenTicket[]> = { queued: [], preparing: [], ready: [] };
    for (const t of board ?? []) {
      (map[t.stage] ??= []).push(t);
    }
    return map;
  }, [board]);

  const printKitchen = async (ticketId: number) => {
    try {
      const { data } = await api.get(`/restaurant/tickets/${ticketId}/kitchen`, { responseType: "blob" });
      printBlob(data);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Cannot print kitchen ticket"), "error");
    }
  };

  const reprintItem = async (ticketId: number, itemId: number) => {
    try {
      const { data } = await api.get(`/restaurant/tickets/${ticketId}/kitchen`, {
        params: { item_ids: String(itemId) },
        responseType: "blob",
      });
      printBlob(data);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Cannot reprint item"), "error");
    }
  };

  if (isError) {
    return (
      <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
        {errorMessage(error, "Failed to load kitchen board")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ChefHat size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Kitchen Display</h1>
            <p className="text-sm text-muted mt-1">Move items through queued → preparing → ready, then mark served.</p>
          </div>
        </div>
      </div>

      {newOrder && (
        <div className="flex items-center gap-2 text-sm font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
          <Clock size={16} />
          New order in the kitchen: {newOrder}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card min-h-64 animate-pulse bg-app" />)}
        </div>
      ) : (board ?? []).length === 0 ? (
        <div className="card p-6">
          <EmptyState
            variant="table"
            icon={<ChefHat size={48} />}
            title="Nothing in the kitchen"
            message="Tickets appear here once they're sent from the floor."
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3 items-start">
          {STAGES.map((stage) => {
            const tickets = byStage[stage.key] ?? [];
            return (
              <section key={stage.key} className={`card overflow-hidden p-0 border-t-4 ${stage.tone}`}>
                <header className="px-4 py-3 bg-app flex items-center justify-between">
                  <h2 className="font-semibold text-ink">{stage.label}</h2>
                  <span className="badge badge-neutral">{tickets.length}</span>
                </header>
                <div className="p-3 space-y-3">
                  {tickets.length === 0 ? (
                    <p className="text-sm text-faint text-center py-8">No tickets</p>
                  ) : (
                    tickets.map((t) => {
                      const readyCount = t.items.filter((i) => i.status === "ready").length;
                      return (
                        <article key={t.id} className="card p-4 space-y-3 border border-border">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <button onClick={() => navigate(`/restaurant/tickets/${t.id}`)} className="font-bold text-ink hover:text-primary">
                                {t.ticket_number}
                              </button>
                              <div className="text-xs text-muted mt-0.5">
                                {t.table_number} · {t.guest_count} guest{t.guest_count === 1 ? "" : "s"}
                              </div>
                              {t.notes && <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">Note: {t.notes}</div>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => printKitchen(t.id)} className="p-1.5 rounded-md bg-app text-muted hover:text-primary" aria-label={`Print ${t.ticket_number}`}>
                                <Printer size={14} />
                              </button>
                              {t.earliest_sent_at && (
                                <span className="flex items-center gap-1 text-xs text-muted">
                                  <Clock size={12} /> {elapsedMin(t.earliest_sent_at)}m
                                </span>
                              )}
                            </div>
                          </div>
                          <ul className="divide-y divide-border">
                            {t.items.filter((i) => i.status !== "pending").map((item) => {
                              const next = nextStep(item.status);
                              return (
                                <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-sm text-ink font-medium flex items-center gap-2">
                                      {item.quantity} × {item.product_name}
                                      <button
                                        onClick={() => reprintItem(t.id, item.id)}
                                        className="p-1 rounded-md bg-app text-faint hover:text-primary"
                                        aria-label={`Reprint ${item.product_name}`}
                                        title="Reprint this item"
                                      >
                                        <Printer size={12} />
                                      </button>
                                    </div>
                                    {item.notes && <div className="text-xs text-muted truncate">Note: {item.notes}</div>}
                                  </div>
                                  {next ? (
                                    <button
                                      onClick={() => startAdvance(t.id, item.id, next)}
                                      disabled={advancing !== null && advancing !== `${t.id}:${item.id}`}
                                      className={`btn-secondary text-xs px-2.5 py-1 flex items-center gap-1 shrink-0 ${
                                        next === "ready" || next === "served" ? "text-emerald-600 dark:text-emerald-400" : ""
                                      }`}
                                    >
                                      <CheckCircle2 size={13} />
                                      {next === "served" ? "Serve" : next === "ready" ? "Ready" : "Start"}
                                    </button>
                                  ) : (
                                    <span className="badge badge-success shrink-0">Done</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          {readyCount > 0 && t.status === "ready" && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">All ready — awaiting serve</p>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}