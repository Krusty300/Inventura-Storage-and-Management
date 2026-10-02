import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, History, PackageCheck, Settings2, TriangleAlert, Trash2 } from "lucide-react";
import api from "../../api/client";
import SlideOver from "../../components/SlideOver";
import { PanelCard, PanelField, PanelFooter, PanelHeader, PanelSection } from "../../components/Panel";
import EmptyState from "../../components/EmptyState";
import StatCard from "../../components/StatCard";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import type { PrepSession, PrepStation } from "../../types";
import { errorMessage } from "../../utils/errors";
import { useDateTimeFormat } from "../../hooks/useDateTimeFormat";

const BATCH_SIZES = [1, 5, 10, 20, 50];

function varianceTone(v: number): string {
  if (v === 0) return "text-emerald-600 dark:text-emerald-400";
  return "text-red-600 dark:text-red-400";
}

export default function RestaurantPrep() {
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const canManage = can("restaurant.prep");
  const formatDateTime = useDateTimeFormat();

  const [station, setStation] = useState("");
  const [wasteFor, setWasteFor] = useState<number | null>(null);
  const [wasteDish, setWasteDish] = useState("");
  const [wasteQty, setWasteQty] = useState("1");
  const [wasteReason, setWasteReason] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [closing, setClosing] = useState<PrepSession | null>(null);
  const [levelsFor, setLevelsFor] = useState<number | null>(null);
  const [levelsDish, setLevelsDish] = useState("");
  const [levelStation, setLevelStation] = useState("");
  const [levelPar, setLevelPar] = useState("0");
  const [levelWarn, setLevelWarn] = useState("0");

  const { data: stations, isLoading, isError, error } = useQuery<PrepStation[]>({
    queryKey: ["restaurant-prep-stations"],
    queryFn: async () => (await api.get("/restaurant/prep/stations")).data,
    refetchInterval: 20_000,
  });

  const { data: openSessions } = useQuery<PrepSession[]>({
    queryKey: ["restaurant-prep-sessions", "open"],
    queryFn: async () => (await api.get("/restaurant/prep/sessions", { params: { status: "open" } })).data,
  });

  const { data: history } = useQuery<PrepSession[]>({
    queryKey: ["restaurant-prep-sessions", "closed"],
    queryFn: async () => (await api.get("/restaurant/prep/sessions", { params: { status: "closed" } })).data,
  });

  const stationNames = useMemo(
    () => (stations ?? []).map((s) => s.station),
    [stations],
  );
  const activeStation = station || stationNames[0] || "";
  const current = (stations ?? []).find((s) => s.station === activeStation) ?? null;
  const activeSession = (openSessions ?? []).find((s) => s.station === activeStation) ?? null;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["restaurant-prep-stations"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-prep-sessions"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-shift-preview"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-shifts"] });
  }

  const openSession = useMutation({
    mutationFn: async (name: string) => (await api.post("/restaurant/prep/sessions", { station: name })).data,
    onSuccess: () => {
      addToast("Prep session opened", "success");
      refresh();
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot open session"), "error"),
  });

  const recordBatch = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: number; quantity: number }) =>
      (await api.post(`/restaurant/prep/sessions/${activeSession?.id}/items`, {
        product_id: productId,
        quantity,
      })).data,
    onSuccess: () => refresh(),
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot record batch"), "error"),
  });

  const bookWaste = useMutation({
    mutationFn: async ({ productId, quantity, reason }: { productId: number; quantity: number; reason: string }) =>
      (await api.post(`/restaurant/prep/sessions/${activeSession?.id}/waste`, {
        product_id: productId,
        quantity,
        reason,
      })).data,
    onSuccess: () => {
      addToast("Waste recorded", "success");
      setWasteFor(null);
      setWasteQty("1");
      setWasteReason("");
      refresh();
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot record waste"), "error"),
  });

  const closeSession = useMutation({
    mutationFn: async (session: PrepSession) =>
      (await api.post(`/restaurant/prep/sessions/${session.id}/close`, {
        counted: session.items
          .filter((i) => i.prepped_qty > 0)
          .map((i) => ({ product_id: i.product_id, counted_qty: Number(counts[i.product_id] ?? 0) || 0 })),
      })).data,
    onSuccess: (row: PrepSession) => {
      addToast(
        row.variance === 0 ? "Prep session balanced" : `Prep closed with variance of ${row.variance}`,
        row.variance === 0 ? "success" : "info",
      );
      setClosing(null);
      setCounts({});
      refresh();
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot close session"), "error"),
  });

  const saveLevels = useMutation({
    mutationFn: async () =>
      (await api.put(`/restaurant/prep/menu-items/${levelsFor}`, {
        prep_station: levelStation.trim() || null,
        par_qty: Number(levelPar) || 0,
        warn_qty: Number(levelWarn) || 0,
      })).data,
    onSuccess: () => {
      addToast("Prep levels updated", "success");
      setLevelsFor(null);
      refresh();
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update prep levels"), "error"),
  });

  function openLevels(item: PrepStation["items"][number]) {
    setLevelsFor(item.product_id);
    setLevelsDish(item.name);
    setLevelStation(item.station);
    setLevelPar(String(item.par_qty));
    setLevelWarn(String(item.warn_qty));
  }

  const totals = useMemo(() => {
    const items = current?.items ?? [];
    return {
      onPass: items.reduce((s, i) => s + i.available_qty, 0),
      prepped: activeSession?.prepped_qty ?? 0,
      sold: activeSession?.sold_qty ?? 0,
      low: items.filter((i) => i.is_below_warn).length,
    };
  }, [current, activeSession]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <ChefHat size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Prep</h1>
          <p className="text-sm text-muted mt-1">
            Record what each station preps. Sales are read from the tickets, so anything unaccounted for at close is flagged.
          </p>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load prep stations")}
        </div>
      )}

      {isLoading ? (
        <div className="card animate-pulse h-40" />
      ) : stationNames.length === 0 ? (
        <div className="card p-6">
          <EmptyState
            variant="block"
            icon={<ChefHat size={48} />}
            title="No dishes on a prep station"
            message="Assign a prep station to a menu item, then set a par level for how many the station should keep ready."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {stationNames.map((name) => (
              <button
                key={name}
                onClick={() => setStation(name)}
                aria-pressed={name === activeStation}
                className={name === activeStation ? "btn-primary" : "btn-secondary"}
              >
                {name}
              </button>
            ))}
            {activeSession ? (
              <span className="text-sm text-muted ml-auto">
                {activeSession.session_number} open since {formatDateTime(activeSession.opened_at)} by {activeSession.username}
              </span>
            ) : (
              <button
                className="btn-primary ml-auto"
                onClick={() => openSession.mutate(activeStation)}
                disabled={openSession.isPending}
              >
                {openSession.isPending ? "Opening…" : `Start ${activeStation} session`}
              </button>
            )}
          </div>

          {current && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="On the pass" value={totals.onPass} icon={PackageCheck} />
              <StatCard label="Prepped" value={totals.prepped} />
              <StatCard label="Sold this session" value={totals.sold} />
              <StatCard label="Below warn level" value={totals.low} tone={totals.low > 0 ? "amber" : "default"} />
            </div>
          )}

          {totals.low > 0 && (
            <div className="flex items-start gap-2 text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-500/20">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                {totals.low} dish{totals.low === 1 ? " is" : "es are"} under the warn level. Prep a batch before service runs out.
              </span>
            </div>
          )}

          <div className="card">
            <h2 className="text-lg font-semibold mb-1">{activeStation} dishes</h2>
            <p className="text-sm text-muted mb-4">
              {activeSession
                ? "Record a batch each time you prep. Sold is derived from the tickets fired since the session opened."
                : "No session is open at this station, so you cannot record a batch yet."}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th scope="col" className="px-4 py-2 font-medium text-muted">Dish</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Par</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted text-right">On pass</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Sold</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Prepped</th>
                    <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(current?.items ?? []).length === 0 ? (
                    <EmptyState
                      icon={<ChefHat size={48} />}
                      title={`Nothing assigned to ${activeStation}`}
                      message="Use the settings button on a dish to move it to this station, or pick another station."
                    />
                  ) : (
                    (current?.items ?? []).map((item) => (
                    <tr key={item.product_id}>
                      <td className="px-4 py-2">
                        <span className="font-medium">{item.name}</span>
                        {item.is_below_warn && (
                          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">low (warn {item.warn_qty})</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{item.par_qty || "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold">{item.available_qty}</td>
                      <td className="px-4 py-2 text-right">{item.sold_qty}</td>
                      <td className="px-4 py-2 text-right">
                        {activeSession?.items.find((i) => i.product_id === item.product_id)?.prepped_qty ?? 0}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {activeSession && (
                          <span className="inline-flex gap-1 items-center">
                            {BATCH_SIZES.map((n) => (
                              <button
                                key={n}
                                className="btn-secondary text-xs px-2 py-1"
                                disabled={recordBatch.isPending}
                                onClick={() => recordBatch.mutate({ productId: item.product_id, quantity: n })}
                              >
                                +{n}
                              </button>
                            ))}
                            <button
                              className="btn-secondary text-xs px-2 py-1"
                              aria-label={`Record waste for ${item.name}`}
                              onClick={() => { setWasteFor(item.product_id); setWasteDish(item.name); setWasteQty("1"); setWasteReason(""); }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </span>
                        )}
                        {canManage && (
                          <button
                            className="btn-secondary text-xs px-2 py-1 ml-1"
                            aria-label={`Prep levels for ${item.name}`}
                            onClick={() => openLevels(item)}
                          >
                            <Settings2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {activeSession && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-1">Close {activeSession.session_number}</h2>
              <p className="text-sm text-muted mb-4">
                Count what is left on the pass. Prepped − sold − waste should match your count; anything else is flagged to a manager.
              </p>
              <div className="space-y-2">
                {activeSession.items.filter((i) => i.prepped_qty > 0).length === 0 ? (
                  <p className="text-sm text-muted">
                    No batches recorded in this session yet, so there is nothing to count. Record a batch above, or close the session as empty.
                  </p>
                ) : (
                  activeSession.items.filter((i) => i.prepped_qty > 0).map((i) => {
                  const expected = i.prepped_qty - i.sold_qty - i.waste_qty;
                  return (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 font-medium">{i.product_name}</span>
                      <span className="text-muted text-xs">
                        {i.prepped_qty} − {i.sold_qty} − {i.waste_qty} = {expected}
                      </span>
                      <input
                        className="input w-24"
                        type="number"
                        min={0}
                        aria-label={`Counted ${i.product_name}`}
                        value={counts[i.product_id] ?? ""}
                        onChange={(e) => setCounts((c) => ({ ...c, [i.product_id]: e.target.value }))}
                      />
                    </div>
                  );
                })
                )}
              </div>
              <button
                className="btn-primary mt-4"
                onClick={() => setClosing(activeSession)}
              >
                Review and close
              </button>
            </div>
          )}

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Recent prep sessions</h2>
            {(history ?? []).length === 0 ? (
              <EmptyState
                compact
                icon={<History size={20} />}
                title="No sessions closed yet"
                message="Once a session is counted and closed, its prepped, sold, and counted totals appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-app text-left">
                      <th scope="col" className="px-4 py-2 font-medium text-muted">Session</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted">Station</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted">Closed</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Prepped</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Sold</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Waste</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(history ?? []).map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2">{row.session_number}</td>
                        <td className="px-4 py-2">{row.station}</td>
                        <td className="px-4 py-2">
                          {formatDateTime(row.closed_at)}
                          <span className="block text-xs text-faint">by {row.closed_by_username || row.username}</span>
                        </td>
                        <td className="px-4 py-2 text-right">{row.prepped_qty}</td>
                        <td className="px-4 py-2 text-right">{row.sold_qty}</td>
                        <td className="px-4 py-2 text-right">{row.waste_qty}</td>
                        <td className={`px-4 py-2 text-right font-medium ${varianceTone(row.variance)}`}>{row.variance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <SlideOver
        open={wasteFor !== null}
        onClose={() => setWasteFor(null)}
        title="Record waste"
      >
        <PanelCard>
          <PanelHeader eyebrow="Prep Waste" title={wasteDish || "Dish"} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              bookWaste.mutate({ productId: wasteFor!, quantity: Number(wasteQty), reason: wasteReason.trim() });
            }}
            className="space-y-0"
          >
            <PanelSection label="Waste Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PanelField label="Quantity" htmlFor="waste-qty">
                  <input
                    id="waste-qty"
                    className="input"
                    type="number"
                    min={1}
                    value={wasteQty}
                    onChange={(e) => setWasteQty(e.target.value)}
                  />
                </PanelField>
                <PanelField label="Reason *" htmlFor="waste-reason">
                  <input
                    id="waste-reason"
                    className="input"
                    value={wasteReason}
                    maxLength={300}
                    onChange={(e) => setWasteReason(e.target.value)}
                    placeholder="Dropped, burnt, over-prepped…"
                  />
                </PanelField>
              </div>
              <p className="text-xs text-muted mt-4">
                Waste has to be declared with a reason. A batch that is short at close shows up as a variance either way, so
                declaring it here is what separates honest spoilage from loss.
              </p>
            </PanelSection>
            <PanelFooter>
              <button type="button" onClick={() => setWasteFor(null)} className="btn-secondary">Cancel</button>
              <button
                type="submit"
                className="btn-primary"
                disabled={wasteReason.trim().length < 3 || Number(wasteQty) < 1 || bookWaste.isPending}
              >
                {bookWaste.isPending ? "Saving…" : "Record waste"}
              </button>
            </PanelFooter>
          </form>
        </PanelCard>
      </SlideOver>

      <SlideOver
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={`Close ${closing?.session_number ?? ""}`}
        wide
      >
        {closing && (
          <PanelCard>
            <PanelHeader eyebrow="Close Session" title={closing.session_number} />
            <div className="space-y-0">
              <PanelSection label="Batch Count">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-app text-left">
                      <th scope="col" className="px-4 py-2 font-medium text-muted">Dish</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Prepped</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Sold</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Waste</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Expected</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Counted</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {closing.items.filter((i) => i.prepped_qty > 0).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">
                          No batches were recorded in {closing.session_number}, so it closes as an empty session.
                        </td>
                      </tr>
                    ) : (
                      closing.items.filter((i) => i.prepped_qty > 0).map((i) => {
                      const expected = i.prepped_qty - i.sold_qty - i.waste_qty;
                      const counted = Number(counts[i.product_id] ?? 0) || 0;
                      const variance = counted - expected;
                      return (
                        <tr key={i.id}>
                          <td className="px-4 py-2">
                            {i.product_name}
                            {i.waste_reason && <span className="block text-xs text-faint">waste: {i.waste_reason}</span>}
                          </td>
                          <td className="px-4 py-2 text-right">{i.prepped_qty}</td>
                          <td className="px-4 py-2 text-right">{i.sold_qty}</td>
                          <td className="px-4 py-2 text-right">{i.waste_qty}</td>
                          <td className="px-4 py-2 text-right">{expected}</td>
                          <td className="px-4 py-2 text-right">
                            <input
                              className="input w-20 text-right"
                              type="number"
                              min={0}
                              aria-label={`Counted ${i.product_name}`}
                              value={counts[i.product_id] ?? ""}
                              onChange={(e) => setCounts((c) => ({ ...c, [i.product_id]: e.target.value }))}
                            />
                          </td>
                          <td className={`px-4 py-2 text-right font-medium ${varianceTone(variance)}`}>{variance}</td>
                        </tr>
                      );
                    })
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted mt-4">
                A non-zero total is saved as-is and raises a manager alert. It cannot be edited afterwards.
              </p>
              </PanelSection>
              <PanelFooter>
                <button type="button" onClick={() => setClosing(null)} className="btn-secondary">Cancel</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={closeSession.isPending}
                  onClick={() => closeSession.mutate(closing)}
                >
                  {closeSession.isPending ? "Closing…" : "Close session"}
                </button>
              </PanelFooter>
            </div>
          </PanelCard>
        )}
      </SlideOver>

      <SlideOver
        open={levelsFor !== null}
        onClose={() => setLevelsFor(null)}
        title="Prep levels"
      >
        <PanelCard>
          <PanelHeader eyebrow="Prep Levels" title={levelsDish || "Dish"} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveLevels.mutate();
            }}
            className="space-y-0"
          >
            <PanelSection label="Station & Thresholds">
              <PanelField label="Station" htmlFor="level-station">
                <input
                  id="level-station"
                  className="input"
                  value={levelStation}
                  maxLength={60}
                  onChange={(e) => setLevelStation(e.target.value)}
                  placeholder="Grill, Fry, Cold…"
                />
              </PanelField>
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-4 mt-4">
                <PanelField label="Par level" htmlFor="level-par">
                  <input
                    id="level-par"
                    className="input"
                    type="number"
                    min={0}
                    value={levelPar}
                    onChange={(e) => setLevelPar(e.target.value)}
                  />
                </PanelField>
                <PanelField label="Warn level" htmlFor="level-warn">
                  <input
                    id="level-warn"
                    className="input"
                    type="number"
                    min={0}
                    value={levelWarn}
                    onChange={(e) => setLevelWarn(e.target.value)}
                  />
                </PanelField>
              </div>
              <p className="text-xs text-muted mt-4">Clearing the station takes the dish off prep tracking.</p>
            </PanelSection>
            <PanelFooter>
              <button type="button" onClick={() => setLevelsFor(null)} className="btn-secondary">Cancel</button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saveLevels.isPending || Number(levelWarn) > Number(levelPar)}
              >
                {saveLevels.isPending ? "Saving…" : "Save levels"}
              </button>
            </PanelFooter>
          </form>
        </PanelCard>
      </SlideOver>
    </div>
  );
}
