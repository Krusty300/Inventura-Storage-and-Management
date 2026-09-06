import { useDateFormat } from "../hooks/useDateFormat";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, MapPin, ClipboardList, PackageOpen, ShieldCheck, ShieldX } from "lucide-react";
import api from "../api/client";
import Modal from "./Modal";
import type { Location, PaginatedResponse } from "../types";
import { formatCurrency } from "../utils/currency";
import { statusBadge } from "../utils/statusBadges";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Skeleton from "./Skeleton";
import { errorMessage } from "../utils/errors";

interface LocationDetailData {
  location: Location;
  stock_lines: {
    id: number;
    product_id: number;
    product_name: string;
    sku: string;
    lot_number: string;
    lot_id: number | null;
    lot_status: string;
    lpn_number: string;
    quantity: number;
    unit_cost: number;
    value: number;
  }[];
  lpns: {
    id: number;
    lpn_number: string;
    lpn_type: string;
    status: string;
    total_quantity: number;
  }[];
  serials: {
    id: number;
    product_id: number;
    product_name: string;
    sku: string;
    serial_number: string;
    lot_number: string;
    lot_status: string;
    status: string;
    lpn_id: number | null;
    lpn_number: string;
    unit_cost: number;
    value: number;
  }[];
  scrapped_serials: {
    id: number;
    product_id: number;
    product_name: string;
    sku: string;
    serial_number: string;
    lot_number: string;
    lot_status: string;
    status: string;
    lpn_id: number | null;
    lpn_number: string;
    unit_cost: number;
    value: number;
  }[];
  movements: {
    id: number;
    product_name: string;
    quantity_change: number;
    movement_type: string;
    username: string;
    from_location: string;
    to_location: string;
    lot_number: string;
    created_at: string;
  }[];
}

interface ActivityLogEntry {
  id: number;
  user_id: number;
  username: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  description: string;
  details: string;
  created_at: string;
}

interface Props {
  location: Location;
  onClose: () => void;
}

type Tab = "stock" | "lpns" | "activity";

export default function LocationDetail({ location, onClose }: Props) {
  const formatDate = useDateFormat();
  const formatDateTime = useDateTimeFormat();
  const [tab, setTab] = useState<Tab>("stock");
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const updateLotMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.put(`/lots/${id}`, { status }),
    onSuccess: () => {
      addToast("Lot updated", "success");
      queryClient.invalidateQueries({ queryKey: ["locations", "detail", location.id] });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot update lot"), "error"),
  });

  const releaseSerialMutation = useMutation({
    mutationFn: (id: number) => api.put(`/serial-numbers/${id}/status`, { status: "in_stock" }),
    onSuccess: () => {
      addToast("Serial released from quarantine", "success");
      queryClient.invalidateQueries({ queryKey: ["locations", "detail", location.id] });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot release serial"), "error"),
  });

  const releaseReservedSerialMutation = useMutation({
    mutationFn: (id: number) => api.post(`/serial-numbers/${id}/release`),
    onSuccess: () => {
      addToast("Serial released from work order", "success");
      queryClient.invalidateQueries({ queryKey: ["locations", "detail", location.id] });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot release serial"), "error"),
  });

  const { data: detail, isLoading } = useQuery({
    queryKey: ["locations", "detail", location.id],
    queryFn: async () => {
      const { data } = await api.get(`/locations/${location.id}/detail`);
      return data as LocationDetailData;
    },
  });

  const { data: activity } = useQuery({
    queryKey: ["activity-logs", "location", location.id],
    queryFn: async () => {
      const { data } = await api.get("/activity-logs", {
        params: { entity_type: "location", entity_id: location.id, limit: 20 },
      });
      return data as PaginatedResponse<ActivityLogEntry>;
    },
  });

  const stockLines = detail?.stock_lines || [];
  const lpns = detail?.lpns || [];
  const serials = detail?.serials || [];
  const availableSerials = serials.filter((s) => s.status === "in_stock" || s.status === "quarantined");
  const reservedSerials = serials.filter((s) => s.status === "reserved");
  const scrappedSerials = detail?.scrapped_serials || [];
  const movements = detail?.movements || [];
  const logs = activity?.items || [];
  const totalStockQty = stockLines.reduce((sum, sl) => sum + sl.quantity, 0) + availableSerials.length;
  const totalStockValue = stockLines.reduce((sum, sl) => sum + sl.value, 0) + availableSerials.reduce((sum, s) => sum + s.value, 0);
  const lotCount = new Set(stockLines.filter((sl) => sl.lot_id).map((sl) => sl.lot_id)).size;

  return (
    <Modal open onClose={onClose} title={location.path} xwide>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-border bg-app p-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-primary-soft text-primary dark:bg-primary/15 dark:text-primary flex items-center justify-center shrink-0">
              <MapPin size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-ink truncate">{location.path}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-muted capitalize">{location.location_type}</span>
                <span className="text-xs text-faint">·</span>
                <span className="text-xs text-muted">{location.code || "no code"}</span>
                <span className="text-xs text-faint">·</span>
                {location.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-warning">Inactive</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
            <div>
              <span className="text-xs text-muted">Name</span>
              <p className="font-medium mt-0.5 truncate">{location.name}</p>
            </div>
            <div>
              <span className="text-xs text-muted">Code</span>
              <p className="font-medium mt-0.5 truncate">{location.code || "—"}</p>
            </div>
            <div>
              <span className="text-xs text-muted">Created</span>
              <p className="font-medium mt-0.5">{formatDate(location.created_at)}</p>
            </div>
            <div>
              <span className="text-xs text-muted">Stock value</span>
              <p className="font-medium mt-0.5">{formatCurrency(location.stock_value, currencySymbol)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 flex-1 min-w-0 rounded-xl border border-border bg-app px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Package size={14} className="text-primary" /> <span className="font-medium text-ink">{totalStockQty}</span> units</span>
            <span className="w-px h-4 bg-border hidden sm:block" />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="font-medium text-ink">{lpns.length}</span> LPNs</span>
            {lotCount > 0 && (
              <>
                <span className="w-px h-4 bg-border hidden sm:block" />
                <span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="font-medium text-ink">{lotCount}</span> lot{lotCount !== 1 ? "s" : ""}</span>
              </>
            )}
            <span className="w-px h-4 bg-border hidden sm:block" />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="font-medium text-ink">{serials.length}</span> serials
              {reservedSerials.length > 0 && <span className="text-amber-600 dark:text-amber-400">({reservedSerials.length} reserved)</span>}
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-muted rounded-xl border border-border bg-app px-4 py-3 shrink-0">
            Value: <span className="font-medium text-ink">{formatCurrency(totalStockValue, currencySymbol)}</span>
          </div>
        </div>

        <div className="flex gap-1 p-1 bg-subtle rounded-lg border border-border w-fit">
          <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>
            <Package size={14} /> Stock ({stockLines.length + serials.length})
          </TabButton>
          <TabButton active={tab === "lpns"} onClick={() => setTab("lpns")}>
            <MapPin size={14} /> LPNs ({lpns.length})
          </TabButton>
          <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
            <ClipboardList size={14} /> Activity ({logs.length + movements.length})
          </TabButton>
        </div>

        {isLoading ? (
          <Skeleton variant="rows" rows={5} cols={6} />
        ) : tab === "stock" ? (
          <>
            {stockLines.length === 0 && serials.length === 0 && scrappedSerials.length === 0 ? (
              <p className="text-muted py-4">No stock at this location.</p>
            ) : (
              <>
            {stockLines.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Bulk stock <span className="text-faint normal-case">({stockLines.length} lines, {stockLines.reduce((sum, sl) => sum + sl.quantity, 0)} units)</span></p>
                <div className="overflow-x-auto max-h-72 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-sm" role="grid" aria-label="Stock at location">
                    <thead>
                      <tr className="bg-subtle text-left text-muted">
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">LPN</th>
                        <th className="px-3 py-2 font-medium text-right">Qty</th>
                        <th className="px-3 py-2 font-medium text-right">Value</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {stockLines.map((sl) => (
                        <tr key={sl.id} className="hover:bg-subtle/50 transition-colors">
                          <td className="px-3 py-2 font-medium">{sl.product_name}</td>
                          <td className="px-3 py-2 text-muted">{sl.sku}</td>
                          <td className="px-3 py-2 text-muted">{sl.lot_number || "—"}{sl.lot_status && sl.lot_status !== "in_stock" ? <LotStatusBadge status={sl.lot_status} /> : null}</td>
                          <td className="px-3 py-2 text-muted">{sl.lpn_number || "—"}</td>
                          <td className="px-3 py-2 text-right font-medium">{sl.quantity}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(sl.value, currencySymbol)}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              {can("lots.update") && sl.lot_id != null && sl.lot_status === "in_stock" && (
                                <button onClick={() => { if (sl.lot_id != null) updateLotMutation.mutate({ id: sl.lot_id, status: "quarantined" }); }} className="p-1 text-faint hover:text-amber-600 dark:text-amber-400" title="Quarantine" aria-label={`Quarantine ${sl.lot_number}`}><ShieldX size={16} /></button>
                              )}
                              {can("lots.update") && sl.lot_id != null && sl.lot_status === "quarantined" && (
                                <button onClick={() => { if (sl.lot_id != null) updateLotMutation.mutate({ id: sl.lot_id, status: "in_stock" }); }} className="p-1 text-faint hover:text-green-600 dark:text-green-400" title="Release" aria-label={`Release ${sl.lot_number}`}><ShieldCheck size={16} /></button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
              </>
            )}
            {serials.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Serialized items ({serials.length})</p>
                <div className="overflow-x-auto max-h-72 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-sm" role="grid" aria-label="Serialized items at location">
                    <thead>
                      <tr className="bg-subtle text-left text-muted">
                        <th className="px-3 py-2 font-medium">Serial #</th>
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">LPN</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Value</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {serials.map((s) => (
                        <tr key={s.id} className="hover:bg-subtle/50 transition-colors">
                          <td className="px-3 py-2 font-medium font-mono">{s.serial_number}</td>
                          <td className="px-3 py-2 text-muted">{s.product_name}</td>
                          <td className="px-3 py-2 text-muted">{s.sku}</td>
                          <td className="px-3 py-2 text-muted">{s.lot_number || "—"}{s.lot_status && s.lot_status !== "in_stock" ? <LotStatusBadge status={s.lot_status} /> : null}</td>
                          <td className="px-3 py-2 text-muted">{s.lpn_number || "—"}</td>
                          <td className="px-3 py-2"><SerialStatusBadge status={s.status} /></td>
                          <td className="px-3 py-2 text-right">{formatCurrency(s.value, currencySymbol)}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end">
                              {can("serial_numbers.update") && s.status === "quarantined" && (
                                <button
                                  onClick={() => releaseSerialMutation.mutate(s.id)}
                                  disabled={releaseSerialMutation.isPending}
                                  className="p-1 text-faint hover:text-green-600 dark:text-green-400"
                                  title="Release from quarantine"
                                  aria-label={`Release ${s.serial_number}`}
                                >
                                  <ShieldCheck size={16} />
                                </button>
                              )}
                              {can("serial_numbers.update") && s.status === "reserved" && (
                                <button
                                  onClick={() => releaseReservedSerialMutation.mutate(s.id)}
                                  disabled={releaseReservedSerialMutation.isPending}
                                  className="p-1 text-faint hover:text-green-600 dark:text-green-400"
                                  title="Release from work order"
                                  aria-label={`Release ${s.serial_number} from work order`}
                                >
                                  <PackageOpen size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {scrappedSerials.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Scrapped serials ({scrappedSerials.length})</p>
                <div className="overflow-x-auto max-h-72 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-sm" role="grid" aria-label="Scrapped serials at location">
                    <thead>
                      <tr className="bg-subtle text-left text-muted">
                        <th className="px-3 py-2 font-medium">Serial #</th>
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">LPN</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {scrappedSerials.map((s) => (
                        <tr key={s.id}>
                          <td className="px-3 py-2 font-medium font-mono">{s.serial_number}</td>
                          <td className="px-3 py-2 text-muted">{s.product_name}</td>
                          <td className="px-3 py-2 text-muted">{s.sku}</td>
                          <td className="px-3 py-2 text-muted">{s.lot_number || "—"}</td>
                          <td className="px-3 py-2 text-muted">{s.lpn_number || "—"}</td>
                          <td className="px-3 py-2"><span className="badge badge-danger">{s.status}</span></td>
                          <td className="px-3 py-2 text-right">{formatCurrency(s.value, currencySymbol)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : tab === "lpns" ? (
          lpns.length === 0 ? (
            <p className="text-muted py-4">No LPNs at this location.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-sm" role="grid" aria-label="LPNs at location">
                <thead>
                  <tr className="bg-subtle text-left text-muted">
                    <th className="px-3 py-2 font-medium">LPN</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lpns.map((l) => (
                    <tr key={l.id} className="hover:bg-subtle/50 transition-colors">
                      <td className="px-3 py-2 font-medium">{l.lpn_number}</td>
                      <td className="px-3 py-2 text-muted capitalize">{l.lpn_type}</td>
                      <td className="px-3 py-2">
                        <span className={`badge ${l.status === "active" ? "badge-success" : "badge-warning"}`}>{l.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{l.total_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : movements.length === 0 && logs.length === 0 ? (
          <p className="text-muted py-4">No activity recorded for this location.</p>
        ) : (
          <>
            {movements.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Stock movements ({movements.length})</p>
                <div className="overflow-x-auto max-h-60 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-sm" role="grid" aria-label="Stock movements at location">
                    <thead>
                      <tr className="bg-subtle text-left text-muted">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 font-medium">From → To</th>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium text-right">Qty</th>
                        <th className="px-3 py-2 font-medium">User</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {movements.map((m) => (
                        <tr key={m.id} className="hover:bg-subtle/50 transition-colors">
                          <td className="px-3 py-2 text-muted">{formatDateTime(m.created_at)}</td>
                          <td className="px-3 py-2 capitalize">{m.movement_type}</td>
                          <td className="px-3 py-2 font-medium">{m.product_name}</td>
                          <td className="px-3 py-2 text-muted">
                            {m.from_location || "—"} → {m.to_location || "—"}
                          </td>
                          <td className="px-3 py-2 text-muted">{m.lot_number || "—"}</td>
                          <td className={`px-3 py-2 text-right ${m.quantity_change < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                            {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                          </td>
                          <td className="px-3 py-2 text-muted">{m.username}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {logs.length > 0 && (
              <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                {logs.map((log) => (
                  <li key={log.id} className="py-2 flex items-start gap-2">
                    <span className={`badge shrink-0 ${statusBadge(log.action)}`}>{log.action}</span>
                    <div className="min-w-0">
                      <p className="text-ink">{log.description}</p>
                      <p className="text-xs text-muted">
                        by {log.username || `User #${log.user_id}`} · {formatDateTime(log.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? "bg-white dark:bg-ink/20 shadow-sm text-ink dark:text-white" : "text-muted hover:text-ink hover:bg-app"
      }`}
    >
      {children}
    </button>
  );
}

function LotStatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusBadge(status)} ml-1.5`}>{status}</span>;
}

function SerialStatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusBadge(status)}`}>{status}</span>;
}
